import { dof } from "three/examples/jsm/tsl/display/DepthOfFieldNode.js";
import {
  abs,
  attribute,
  cross,
  cameraPosition,
  cameraViewMatrix,
  clamp,
  cubeTexture,
  dot,
  exp,
  float,
  fract,
  int,
  ivec2,
  length,
  max,
  min,
  mix,
  mx_noise_float,
  mx_noise_vec3,
  normalize,
  positionView,
  positionWorld,
  pow,
  reflect,
  reflectVector,
  refract,
  screenUV,
  select,
  smoothstep,
  sqrt,
  texture,
  textureLoad,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  CubeCamera,
  DataTexture,
  Float32BufferAttribute,
  FloatType,
  HalfFloatType,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  Quaternion,
  RenderTarget,
  RGBAFormat,
  type Node,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLCubeRenderTarget,
} from "three/webgpu";
import { download, exportVideo } from "./export";
import { createStage } from "./stage";

type Header = {
  fps: number;
  frames: number;
  chunks: number;
  hit: number;
  thick: number;
  gap: number;
  impact: [number, number, number];
  ball: { radius: number; z0: number; speed: number };
  scale: number;
  small: boolean;
  vertices: number;
  triangles: number;
  keys: number;
};

/** back from pack_bake.py's keys to a chunk per frame, and to flat-shaded triangles */
function decode(buffer: ArrayBuffer) {
  const headerLength = new DataView(buffer).getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength))) as Header;
  const { chunks: n, frames, keys, vertices, triangles } = meta;
  let at = 4 + headerLength;
  const floats = (length: number) => {
    const array = new Float32Array(buffer, at, length);
    at += array.byteLength;
    return array;
  };
  const shorts = (length: number) => {
    const array = new Uint16Array(buffer, at, length);
    at += array.byteLength;
    return array;
  };
  const signed = (length: number) => {
    const array = new Int16Array(buffer, at, length);
    at += array.byteLength;
    return array;
  };
  const arrival = floats(n);
  const low = floats(n * 3);
  const span = floats(n * 3);
  const vertexCounts = shorts(n);
  const triangleCounts = shorts(n);
  const keyCounts = shorts(n);
  const keyFrames = shorts(keys);
  const keyPositions = shorts(keys * 3);
  const keyTurns = signed(keys * 4);
  const points = signed(vertices * 3);
  const corners = meta.small ? new Uint8Array(buffer, at, triangles * 3) : new Uint16Array(buffer, at, triangles * 3);

  const motion = new Float32Array(frames * n * 7);
  const position = new Float32Array(triangles * 9);
  const normal = new Float32Array(triangles * 9);
  const chunkOf = new Float32Array(triangles * 3);
  // per corner: distance from the impact, radial (0) or ring (1) crack, a per-chunk
  // random, and whether this face was already the outside of the pane
  const crack = new Float32Array(triangles * 12);
  const closed = new Float32Array(n); // chunks were shrunk to leave air: this closes it
  const radii = new Float32Array(n);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let key = 0;
  let firstPoint = 0;
  let corner = 0;
  for (let i = 0; i < n; i++) {
    const value = (k: number, axis: number) =>
      axis < 3
        ? low[i * 3 + axis] + (keyPositions[k * 3 + axis] / 65535) * span[i * 3 + axis]
        : keyTurns[k * 4 + axis - 3] / 32767;
    for (let k = key; k < key + keyCounts[i] - 1; k++) {
      const from = keyFrames[k];
      const to = keyFrames[k + 1];
      for (let f = from; f <= to; f++) {
        const t = (f - from) / (to - from);
        const out = (f * n + i) * 7;
        for (let axis = 0; axis < 7; axis++) motion[out + axis] = value(k, axis) + (value(k + 1, axis) - value(k, axis)) * t;
        const size = Math.hypot(motion[out + 3], motion[out + 4], motion[out + 5], motion[out + 6]);
        for (let axis = 3; axis < 7; axis++) motion[out + axis] /= size;
      }
    }
    key += keyCounts[i];

    let radius = 0;
    for (let t = 0; t < triangleCounts[i]; t++) {
      const load = (v: Vector3, k: number) => {
        const p = (firstPoint + corners[corner + k]) * 3;
        v.set(points[p], points[p + 1], points[p + 2]).multiplyScalar(meta.scale);
        position.set([v.x, v.y, v.z], (corner + k) * 3);
        chunkOf[corner + k] = i;
        radius = Math.max(radius, v.length());
      };
      load(a, 0);
      load(b, 1);
      load(c, 2);
      b.sub(a);
      c.sub(a);
      b.cross(c).normalize();
      for (let k = 0; k < 3; k++) normal.set([b.x, b.y, b.z], (corner + k) * 3);

      const rest = (k: number, axis: number) => position[(corner + k) * 3 + axis] + motion[i * 7 + axis];
      const middle = (axis: number) => (rest(0, axis) + rest(1, axis) + rest(2, axis)) / 3;
      const [x, y, depth] = [middle(0), middle(1), middle(2)];
      const dx = x - meta.impact[0];
      const dy = y - meta.impact[1];
      const flatness = Math.hypot(b.x, b.y);
      // a face looking along the radius is a ring crack, one looking across it is radial
      const across = Math.abs(b.x * dx + b.y * dy) / (Math.hypot(dx, dy) * flatness || 1);
      const kind = flatness < 0.25 ? 1 : smooth(0.35, 0.75, across);
      const faces = Math.abs(b.z) > 0.9 && Math.abs(depth) > meta.thick / 2 - 0.012;
      const rim = flatness > 0.7 && Math.max(Math.abs(x), Math.abs(y)) > 1.22;
      const random = Math.abs(Math.sin((i + 1) * 12.9898) * 43758.5453) % 1;
      for (let k = 0; k < 3; k++) {
        const r = Math.hypot(rest(k, 0) - meta.impact[0], rest(k, 1) - meta.impact[1]);
        crack.set([r, kind, random, faces || rim ? 1 : 0], (corner + k) * 4);
      }
      corner += 3;
    }
    firstPoint += vertexCounts[i];
    radii[i] = radius;
    // a little past closed: stone would show any seam left between chunks
    closed[i] = 1 + Math.min(0.4, (meta.gap * 1.8) / Math.max(radius, 1e-3));
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  geometry.setAttribute("chunk", new Float32BufferAttribute(chunkOf, 1));
  geometry.setAttribute("crack", new Float32BufferAttribute(crack, 4));
  return {
    ...meta,
    arrival,
    motion,
    closed,
    radii,
    geometry,
    slab: new BoxGeometry(2.5, 2.5, meta.thick),
    /** how long its shards stay around, in sim seconds */
    lifetime: frames / meta.fps - 0.02,
    /** thin glass is less blue, but not in proportion or it would vanish */
    depth: Math.sqrt(meta.thick / 0.42),
  };
}
type Glass = ReturnType<typeof decode>;

const SPACING = 6;
const HITS = 3;
const GLASSES = ["thin", "medium", "thick"] as const;
type GlassName = (typeof GLASSES)[number];

const AUTO = "auto path";
const FREE = "free";
/** azimuth (0 behind the ball, 180 where it's heading), elevation, distance */
const SHOTS: Record<string, [number, number, number]> = {
  side: [72, 8, 3.2],
  "three quarter": [140, 10, 2.2],
  "head on": [180, 2, 2.6],
  "behind the ball": [10, 7, 1.9],
  "low, grazing": [58, -24, 1.9],
  above: [90, 62, 2.5],
  macro: [125, 5, 0.95],
};
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How far the ball has got between two panes, against time. Each stretch ends where
 * the next starts, one pane along: only the rate in between is free to change.
 */
function timeCurve(slowdown: number, travel: number, contact: number, width: number, brake: number) {
  const N = 4096;
  const table = new Float64Array(N + 1);
  // integrate 1/rate along the sim, then invert: phase as a function of progress
  const seconds = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) {
    const g = (i - 0.5) / N;
    // full speed into the hit: the brakes only go on once it has landed
    const past = g - contact;
    const slowed = smooth(0, brake, past) * (1 - smooth(width * 2, width * 3.2, past));
    const rate = travel + (slowdown - travel) * slowed;
    seconds[i] = seconds[i - 1] + 1 / rate / N;
  }
  const total = seconds[N];
  let i = 0;
  for (let k = 0; k <= N; k++) {
    const target = (k / N) * total;
    while (i < N && seconds[i + 1] < target) i++;
    const span = seconds[i + 1] - seconds[i] || 1;
    table[k] = (i + (target - seconds[i]) / span) / N;
  }
  return {
    at(phase: number) {
      const x = phase * N;
      const k = Math.min(N - 1, Math.floor(x));
      return table[k] + (table[k + 1] - table[k]) * (x - k);
    },
    /** phase at a given progress */
    phaseOf: (g: number) => seconds[Math.round(g * N)] / total,
  };
}

/** a closed curve through keys, with smooth tangents */
function keyframes(keys: [number, number][], wrap: number) {
  const n = keys.length;
  const key = (i: number): [number, number] => {
    const lap = Math.floor(i / n);
    const [t, v] = keys[((i % n) + n) % n];
    return [t + lap, v + lap * wrap];
  };
  return (t: number) => {
    let i = -1;
    while (i < n - 1 && keys[i + 1][0] <= t) i++;
    const [t0, v0] = key(i);
    const [t1, v1] = key(i + 1);
    const [ta, va] = key(i - 1);
    const [tb, vb] = key(i + 2);
    const h = t1 - t0;
    const s = (t - t0) / h;
    const m0 = ((v1 - va) / (t1 - ta)) * h;
    const m1 = ((vb - v0) / (tb - t0)) * h;
    return (2 * s ** 3 - 3 * s ** 2 + 1) * v0 + (s ** 3 - 2 * s ** 2 + s) * m0 + (-2 * s ** 3 + 3 * s ** 2) * v1 + (s ** 3 - s ** 2) * m1;
  };
}

export type PieceOptions = {
  /** where the packed sims are served from */
  bakes?: string;
  /** pixels to leave free at the side of the window */
  margin?: number;
  /** start with the controls open */
  panel?: boolean;
};

export default async function createPiece({ bakes: bakeUrl = "./bake/", margin = 0, panel = false }: PieceOptions = {}) {
  const bakes = new Map<string, Record<GlassName, Glass>>();
  /** the big ball is its own set of sims, fetched only if it's asked for */
  const loadBakes = async (size: string) => {
    if (!bakes.has(size)) {
      const prefix = size === "x2" ? "big-" : "";
      const entries = await Promise.all(
        GLASSES.map(async (name) => {
          const response = await fetch(`${bakeUrl}${prefix}${name}.bin`);
          return [name, decode(await response.arrayBuffer())] as const;
        }),
      );
      bakes.set(size, Object.fromEntries(entries) as Record<GlassName, Glass>);
    }
    return bakes.get(size)!;
  };
  let glasses = await loadBakes("normal");
  let ballRadius = glasses.thick.ball.radius;
  const ballSpeed = glasses.thick.ball.speed;
  const impact = glasses.thick.impact;
  const fullest = Math.max(...GLASSES.map((name) => glasses[name].chunks));

  const stage = await createStage({ loop: 21, fov: 34, distance: 3, margin, bloom: 0.1, exposure: 1 });
  const { renderer, scene, camera } = stage;
  camera.far = 500; // the corridor's far end
  camera.updateProjectionMatrix();
  const config = {
    ball: "normal",
    walls: "stone, coloured inside",
    slowdown: 0.015,
    window: 0.09,
    brake: 0.015,
    travel: 0.35,
    drift: 7,
    focus: 1.7,
    bokeh: 3.5,
    clearView: 0,
    lensClear: 0.45,
    crackSpeed: 30,
    ringSpeed: 16,
    glass: "#145bc8",
    depth: 1,
    inside: "#ff3a12",
    insideGlow: 0.25,
    background: "solid colour",
    backdrop: "#000000",
    reflected: 1,
    glow: 0.35,
  };
  /** each hit: which glass, and where the camera sits round the ball as it lands */
  const hits: {
    glass: GlassName;
    azimuth: number;
    elevation: number;
    distance: number;
    aim: number;
    /** seconds after contact before it sets off for the next angle */
    hold: number;
    /** how much further away it ends up by then */
    pull: number;
    /** and how far round, in degrees */
    sweep: number;
  }[] = [
    // the side it comes from, well round onto the face so the cracks read. Leaves early
    // for the far side of the next wall
    { glass: "thin", azimuth: 42, elevation: 10, distance: 2.6, aim: 0, hold: 1.6, pull: 0, sweep: 0 },
    // the far side: the wall bursts towards the lens. The ball is behind it at first,
    // so the camera looks ahead of it, at the spot that's about to give
    { glass: "thick", azimuth: 140, elevation: 12, distance: 3.3, aim: 0.55, hold: 3, pull: 0, sweep: 0 },
    // behind, then backing away through the slow motion for depth: the debris, the wall
    // and the corridor beyond it. It also has to cross behind the ball to reach the next
    // angle, and does it now, while still clear of this wall: later, it would be flying
    // through what's left of it
    { glass: "medium", azimuth: 310, elevation: 10, distance: 2.7, aim: 0, hold: 4.5, pull: 2.6, sweep: 66 },
  ];

  const backdrop = uniform(new Color(config.backdrop));
  const showTiles = uniform(1);
  const reflected = uniform(1);
  const through = uniform(1);
  const crackSpeed = uniform(config.crackSpeed);
  const ringSpeed = uniform(config.ringSpeed);
  const radius = uniform(ballRadius);
  const insideOn = uniform(0);
  const insideColour = uniform(new Color(config.inside));
  const insideGlow = uniform(config.insideGlow);

  // --- the room: unlit, it's what the glass and the ball see ---------------------
  const roomMaterial = new MeshBasicNodeMaterial({ side: BackSide });
  const roomInReflections = new MeshBasicNodeMaterial({ side: BackSide });
  {
    const p = positionWorld;
    const nrm = attribute("normal", "vec3");
    const uv = select(abs(nrm.x).greaterThan(0.5), p.zy, select(abs(nrm.y).greaterThan(0.5), p.xz, p.xy));
    const cell = abs(fract(uv).sub(0.5));
    const line = smoothstep(0.482, 0.494, max(cell.x, cell.y));
    const floorGlow = smoothstep(-2.6, 3.4, p.y).mul(0.1);
    const corner = smoothstep(4.9, 3.2, abs(p.x)).mul(0.1).add(0.86);
    const ceiling = smoothstep(-0.2, 0.2, nrm.y.negate()).mul(smoothstep(1.5, 1.1, abs(p.x))).mul(4.5);
    const tiles = vec3(corner.add(floorGlow)).mul(mix(float(1), float(0.72), line)).add(ceiling);
    roomMaterial.colorNode = mix(backdrop, tiles, showTiles);
    roomInReflections.colorNode = mix(backdrop, tiles, reflected);
  }
  const room = new Mesh(new BoxGeometry(10, 6, 600), roomMaterial);
  room.position.y = 0.4;
  scene.add(room);

  // the room as a cube map, for glass: captured once
  const cubeOptions = { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter };
  const roomCube = new WebGLCubeRenderTarget(512, cubeOptions);
  const roomCamera = new CubeCamera(0.1, 500, roomCube);
  roomCamera.update(renderer, scene);

  // the ball sees everything, every frame
  const ballCube = new WebGLCubeRenderTarget(384, { type: HalfFloatType });
  const ballCamera = new CubeCamera(0.05, 60, ballCube);

  // --- glass ----------------------------------------------------------------------
  const size = renderer.getDrawingBufferSize(new Vector2());
  const backs = new RenderTarget(size.x, size.y, { type: HalfFloatType, depthBuffer: true });
  const backScene = new Scene();
  const ballCentre = uniform(new Vector3());
  const blue = uniform(new Vector3());

  const view = normalize(positionWorld.sub(cameraPosition));
  const roomAt = (direction: Node) => cubeTexture(roomCube.texture, direction).xyz;
  const seenThrough = (direction: Node) => mix(backdrop, roomAt(direction), through);
  const mirrored = (direction: Node) => mix(backdrop, roomAt(direction), reflected);
  const fresnel = (n: Node) => float(0.04).add(float(0.96).mul(pow(float(1).sub(abs(dot(view, n))), 5)));

  /** the three materials glass needs, for one way of getting positions and normals */
  const glassSet = (N: Node, depth: Node, position?: Node, backN: Node = N, opened: Node = float(1), thickness: Node = float(0)) => {
    const back = new MeshBasicNodeMaterial({ side: BackSide });
    back.outputNode = vec4(backN, length(positionView));

    // two surfaces: in through this face, out through the one behind it
    const main = new MeshBasicNodeMaterial();
    const inside = refract(view, N, 1 / 1.52);
    const near = length(positionView);
    const first = texture(backs.texture, screenUV);
    const roughPath = clamp(first.w.sub(near), 0, 2);
    const shift = cameraViewMatrix.mul(vec4(inside, 0)).xy.mul(roughPath).mul(0.42).div(near);
    const behind = texture(backs.texture, screenUV.add(vec2(shift.x, shift.y.negate())));
    // Where no crack has reached, this is still one flat slab, whatever the chunks under
    // it are doing: light goes straight through, and for the slab's full depth
    // A crack that has opened further in shows through an intact surface, though: unopened
    // faces behind this one all point along z, so anything else is a crack plane
    const open = max(opened, smoothstep(0.03, 0.25, float(1).sub(abs(first.z))));
    const measured = clamp(behind.w.sub(near), 0, 2);
    const path = mix(thickness.div(max(abs(inside.z), 0.25)), measured, open);
    const backNormal = behind.xyz.negate();
    const out = refract(inside, backNormal, 1.52);
    const trapped = dot(out, out).lessThan(0.01);
    const exit = select(trapped, reflect(inside, backNormal), out);
    const hasBack = measured.greaterThan(0.002);
    const direction = normalize(mix(view, select(hasBack, exit, inside), open));

    // the ball seen through the glass: nothing else exists behind it
    const from = positionWorld.add(inside.mul(path));
    const oc = from.sub(ballCentre);
    const b = dot(oc, direction);
    const c = dot(oc, oc).sub(radius.mul(radius));
    const disc = b.mul(b).sub(c);
    const hit = disc.greaterThan(0).and(b.negate().sub(sqrt(max(disc, 0))).greaterThan(0));
    const onBall = normalize(from.add(direction.mul(b.negate().sub(sqrt(max(disc, 0))))).sub(ballCentre));
    const seen = select(hit, cubeTexture(ballCube.texture, reflect(direction, onBall)).xyz, seenThrough(direction));

    // thin chunks still need to read as deep glass, so no path is shorter than this
    const absorbed = exp(blue.mul(max(path, depth.mul(0.16)).mul(1.3).add(depth.mul(0.12))).negate());
    const body = seen.mul(absorbed).mul(mix(float(1), select(trapped, float(1.35), float(1)), open));
    main.colorNode = mix(body, mirrored(reflect(view, N)), fresnel(N));

    // for the ball's own reflection: one surface is plenty at that size
    const cheap = new MeshBasicNodeMaterial();
    cheap.colorNode = mix(
      seenThrough(refract(view, N, 1 / 1.52)).mul(exp(blue.mul(depth.mul(0.4)).negate())),
      mirrored(reflect(view, N)),
      fresnel(N),
    );
    if (position) for (const material of [back, main, cheap]) material.positionNode = position;
    return { back, main, cheap };
  };

  /** no lights in this scene, so stone works out its own. `opened` is how far a crack
   *  has reached this point, `apart` whether the pieces have actually separated */
  const stoneMaterial = (N: Node, surface: Node, opened: Node, apart: Node, position?: Node) => {
    const material = new MeshBasicNodeMaterial();
    const local = attribute("position", "vec3"); // the grain travels with the chunk
    const fracture = float(1).sub(surface).mul(opened);
    const rough = normalize(N.add(mx_noise_vec3(local.mul(26)).mul(mix(float(0.05), float(0.42), fracture))));
    const grain = mx_noise_float(local.mul(17)).mul(0.05).add(mx_noise_float(local.mul(70)).mul(0.03)).add(0.95);
    const light = float(0.68)
      .add(rough.y.mul(0.1).add(0.1))
      .add(max(dot(rough, normalize(vec3(0.35, 0.85, 0.4))), 0).mul(0.42))
      .add(max(dot(rough, normalize(vec3(-0.6, -0.15, -0.5))), 0).mul(0.3));
    const white = vec3(0.95, 0.94, 0.91).mul(grain);
    const inner = mix(vec3(0.74, 0.72, 0.68).mul(grain), insideColour, insideOn);
    // a crack that hasn't opened yet reads as a line
    const line = opened.mul(float(1).sub(apart)).mul(float(1).sub(surface)).mul(float(1).sub(insideOn));
    const shade = smoothstep(radius.mul(0.9), radius.mul(2.4), length(positionWorld.sub(ballCentre))).mul(0.25).add(0.75);
    material.colorNode = mix(white, inner, fracture)
      .mul(light)
      .mul(shade)
      .mul(mix(float(1), float(0.3), line))
      .add(insideColour.mul(insideGlow).mul(insideOn).mul(fracture));
    if (position) material.positionNode = position;
    return material;
  };

  const ballMaterial = new MeshBasicNodeMaterial();
  ballMaterial.colorNode = cubeTexture(ballCube.texture, reflectVector).xyz.mul(0.97);
  const ball = new Mesh(new SphereGeometry(1, 96, 64), ballMaterial);
  ball.scale.setScalar(ballRadius);
  scene.add(ball);

  // --- the sim ---------------------------------------------------------------------
  // Geometry stays on the GPU, untouched. Each frame only a small texture changes:
  // three texels per chunk, for position and scale, rotation, and whether it has broken
  const rotate = (q: Node, v: Node) => v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2));

  const slots = hits.map((hit) => {
    const data = new Float32Array(fullest * 3 * 4);
    const state = new DataTexture(data, fullest * 3, 1, RGBAFormat, FloatType);
    state.minFilter = state.magFilter = NearestFilter;
    state.needsUpdate = true;
    const depth = uniform(glasses[hit.glass].depth);
    const since = uniform(0); // sim seconds since the ball touched this pane

    const at = int(attribute("chunk", "float")).mul(3);
    const placed = textureLoad(state, ivec2(at, 0));
    const turned = textureLoad(state, ivec2(at.add(1), 0));
    const broken = textureLoad(state, ivec2(at.add(2), 0)).x;
    const local = attribute("position", "vec3");
    const moved = rotate(turned, local).mul(placed.w).add(placed.xyz);
    const raw = rotate(turned, attribute("normal", "vec3"));
    // until the crack reaches it, a chunk reads as part of the flat slab. The pane's
    // outer rim keeps a real normal though, or edge-on it all turns to grazing reflection
    const crack = attribute("crack", "vec4");
    const flat = vec3(0, 0, select(raw.z.greaterThanEqual(0), float(1), float(-1)));
    const whole = select(crack.w.greaterThan(0.5).and(abs(raw.z).lessThan(0.6)), raw, flat);
    // Cracks don't wait for the chunk: each face opens on its own, and each corner of it
    // at its own time, so a line grows along the chunk. Radials run out first, rings
    // follow between them, and only later do the pieces come apart
    const reach = mix(crack.x.div(crackSpeed), crack.x.div(ringSpeed).add(0.008), crack.y).mul(crack.z.mul(0.35).add(1));
    const opened = max(broken, smoothstep(0, 0.005, since.sub(reach)));
    const N = varying(normalize(mix(whole, raw, opened)));
    const backN = varying(normalize(mix(flat, raw, opened)));

    const thickness = uniform(glasses[hit.glass].thick);
    const set = glassSet(N, depth, moved, backN, varying(opened), thickness);
    const stone = stoneMaterial(N, varying(crack.w), varying(opened), varying(broken), moved);
    const mesh = new Mesh(glasses[hit.glass].geometry, set.main);
    const back = new Mesh(glasses[hit.glass].geometry, set.back);
    mesh.frustumCulled = back.frustumCulled = false;
    scene.add(mesh);
    backScene.add(back);
    return { hit, set, stone, mesh, back, data, state, depth, since, thickness };
  });

  // the unbroken slabs, for panes the ball hasn't reached
  const slabSets = Object.fromEntries(
    GLASSES.map((name) => [name, glassSet(attribute("normal", "vec3"), float(glasses[name].depth))]),
  ) as Record<GlassName, ReturnType<typeof glassSet>>;
  const stoneSlab = stoneMaterial(attribute("normal", "vec3"), float(1), float(0), float(0));
  const slabs = [0, 1, 2, 3, 4].map(() => {
    const slab = new Mesh(glasses.thick.slab, slabSets.thick.main);
    const back = new Mesh(glasses.thick.slab, slabSets.thick.back);
    scene.add(slab);
    backScene.add(back);
    return { slab, back, glass: "thick" as GlassName };
  });

  const perPane = SPACING / ballSpeed; // sim seconds between panes
  const startProgress = 0.42; // about where between panes each impact falls
  /** exactly where: the ball's path is fixed, so thicker glass is met a little sooner */
  const contactOf = (hit: (typeof hits)[number]) => startProgress + (0.1 - glasses[hit.glass].thick / 2) / SPACING;
  const makeCurves = () =>
    hits.map((hit) => timeCurve(config.slowdown, config.travel, contactOf(hit), config.window, config.brake));
  let curves = makeCurves();
  const rebuild = () => (curves = makeCurves());

  const useBall = async (size: string) => {
    glasses = await loadBakes(size);
    ballRadius = radius.value = glasses.thick.ball.radius;
    ball.scale.setScalar(ballRadius);
    for (const slot of slots) slot.mesh.geometry = slot.back.geometry = glasses[slot.hit.glass].geometry;
  };
  stage.gui.add(config, "ball", ["normal", "x2"]).onChange(useBall);
  stage.gui.add(config, "walls", ["glass", "white stone", "stone, coloured inside"]);
  stage.gui.add(config, "slowdown", 0.004, 0.2, 0.001).onFinishChange(rebuild);
  stage.gui.add(config, "window", 0.02, 0.2, 0.001).onFinishChange(rebuild).name("slow window");
  stage.gui.add(config, "brake", 0.002, 0.1, 0.001).onFinishChange(rebuild).name("braking after hit");
  stage.gui.add(config, "travel", 0.05, 1, 0.01).onFinishChange(rebuild).name("speed between hits");
  stage.gui.add(config, "crackSpeed", 1, 30, 0.1).name("crack speed");
  stage.gui.add(config, "ringSpeed", 0.5, 20, 0.1).name("ring crack speed");
  stage.gui.add(config, "bokeh", 0, 14, 0.1);
  stage.gui.add(config, "clearView", 0, 0.8, 0.01).name("shrink shards in front of ball");
  stage.gui.add(config, "lensClear", 0, 1.5, 0.01).name("fade shards at the lens");

  const glassFolder = stage.gui.addFolder("glass");
  glassFolder.addColor(config, "glass").name("colour");
  glassFolder.add(config, "depth", 0, 2, 0.01).name("how deep");

  const stoneFolder = stage.gui.addFolder("stone");
  stoneFolder.addColor(config, "inside").name("inside colour");
  stoneFolder.add(config, "insideGlow", 0, 2, 0.01).name("inside glow");

  const backgroundFolder = stage.gui.addFolder("background");
  backgroundFolder.add(config, "background", ["tile room", "solid colour"]);
  backgroundFolder.addColor(config, "backdrop").name("colour");
  backgroundFolder.add(config, "reflected", 0, 1, 0.01).name("room in reflections");
  backgroundFolder.add(config, "glow", 0, 1, 0.01).name("room through glass");

  // --- the camera: a scripted path, or wherever you put it ---------------------------
  const { controls } = stage;
  controls.minDistance = 0.35;
  controls.maxDistance = 8;
  const rig = { shot: AUTO, azimuth: 0, elevation: 0, distance: 3 };
  const isAuto = () => rig.shot === AUTO;
  const lastBall = new Vector3();
  const offset = new Vector3();
  const place = (azimuth: number, elevation: number, distance: number) => {
    const a = toRadians(azimuth);
    const e = toRadians(elevation);
    offset.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(distance);
    camera.position.copy(controls.target).add(offset);
  };
  // a shot eases in by wall clock, so it still works while time is paused
  let move: { from: number[]; to: number[]; pan: Vector3; start: number } | null = null;
  const goTo = (name: string) => {
    rig.shot = name;
    const to = SHOTS[name];
    const turn = to && ((to[0] - rig.azimuth + 540) % 360) - 180; // the short way round
    move = to && {
      from: [rig.azimuth, rig.elevation, rig.distance],
      to: [rig.azimuth + turn, to[1], to[2]],
      pan: controls.target.clone().sub(ball.position),
      start: performance.now(),
    };
  };
  let frozen = -1;
  const freeze = () => {
    frozen = (frozen + 1) % HITS;
    stage.time.seek((frozen + curves[frozen].phaseOf(contactOf(hits[frozen]) + 0.03)) / HITS);
    stage.time.paused = true;
  };
  const byHand = () => {
    rig.shot = FREE;
    move = null;
  };
  controls.addEventListener("start", byHand);

  const folder = stage.gui.addFolder("camera");
  folder.add(rig, "shot", [AUTO, ...Object.keys(SHOTS), FREE]).listen().onChange(goTo);
  folder.add({ freeze }, "freeze").name("freeze on the next hit (H)");
  const dial = () => {
    byHand();
    place(rig.azimuth, rig.elevation, rig.distance);
  };
  folder.add(rig, "azimuth", 0, 360, 0.5).listen().onChange(dial);
  folder.add(rig, "elevation", -85, 85, 0.5).listen().onChange(dial);
  folder.add(rig, "distance", 0.35, 8, 0.01).listen().onChange(dial);
  stage.clock.open();
  if (!panel) stage.gui.close();

  // 16 Mbit is plenty at this size: Twitter re-encodes whatever it gets
  const video = { size: 1024, fps: 60, megabits: 16 };
  const exportFolder = stage.gui.addFolder("export video");
  exportFolder.add(video, "size", 256, 2048, 2);
  exportFolder.add(video, "fps", [30, 60]);
  exportFolder.add(video, "megabits", 4, 40, 1);
  const exportButton = exportFolder
    .add(
      {
        start: async () => {
          exportButton.disable();
          const { size: pixels, fps, megabits } = video;
          try {
            const blob = await exportVideo(stage, {
              size: pixels,
              fps,
              bitrate: megabits * 1e6,
              onProgress: (done) => exportButton.name(`rendering ${Math.round(done * 100)}% (keep this tab open)`),
            });
            (window as unknown as { __video: Blob }).__video = blob;
            download(blob, `shatter-${pixels}-${fps}fps.mp4`);
          } finally {
            exportButton.name("export one loop as mp4").enable();
          }
        },
      },
      "start",
    )
    .name("export one loop as mp4");

  hits.forEach((hit, index) => {
    const each = stage.gui.addFolder(`hit ${index + 1}`).close();
    each.add(hit, "glass", [...GLASSES]).onChange((name: GlassName) => {
      const slot = slots[index];
      slot.mesh.geometry = slot.back.geometry = glasses[name].geometry;
      slot.depth.value = glasses[name].depth;
      rebuild();
    });
    each.add(hit, "azimuth", 0, 360, 1);
    each.add(hit, "elevation", -60, 85, 0.5);
    each.add(hit, "distance", 1, 6, 0.01);
    each.add(hit, "aim", 0, 1.5, 0.01).name("look ahead of ball");
    each.add(hit, "hold", 0.2, 6, 0.1).name("seconds held");
    each.add(hit, "pull", 0, 5, 0.01).name("pull back while held");
    each.add(hit, "sweep", 0, 120, 1).name("swing round while held");
  });
  folder.add(config, "drift", 0, 30, 0.5).name("drift while held");

  addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    const shot = [AUTO, ...Object.keys(SHOTS)][Number(event.key) - 1];
    if (shot) goTo(shot);
    if (event.key === "h" || event.key === "H") freeze();
    if (event.key === " ") {
      event.preventDefault();
      stage.time.paused = !stage.time.paused;
    }
  });

  const focus = uniform(2.7);
  const focal = uniform(config.focus);
  const bokeh = uniform(config.bokeh);
  stage.post.outputNode = dof(stage.sceneColor, stage.scenePass.getViewZNode(), focus, focal, bokeh).add(stage.glare);
  stage.post.needsUpdate = true;

  const q0 = new Quaternion();
  const q1 = new Quaternion();
  const lens = new Vector3();
  const sight = new Vector3();
  let sightLength = 1;
  const pose = (slot: (typeof slots)[number], glass: Glass, time: number, pane: number) => {
    const { data } = slot;
    const { motion, chunks: n, frames, fps, arrival, closed, radii, lifetime } = glass;
    const f = Math.min(frames - 1.001, Math.max(0, time * fps));
    const a = Math.floor(f);
    const t = f - a;
    const fade = 1 - smooth(lifetime - 0.2, lifetime, time);
    for (let i = 0; i < n; i++) {
      const A = (a * n + i) * 7;
      const B = A + n * 7;
      const x = motion[A] + (motion[B] - motion[A]) * t;
      const y = motion[A + 1] + (motion[B + 1] - motion[A + 1]) * t;
      const z = motion[A + 2] + (motion[B + 2] - motion[A + 2]) * t - pane * SPACING;
      q0.set(motion[A + 3], motion[A + 4], motion[A + 5], motion[A + 6]);
      q1.set(motion[B + 3], motion[B + 4], motion[B + 5], motion[B + 6]);
      q0.slerp(q1, t);
      const arrived = smooth(0, 0.006, time - arrival[i]);
      // optional: shrink what sits between the lens and the ball. Off by default, as
      // those are often the shards the ball is dragging along
      const px = x - lens.x;
      const py = y - lens.y;
      const pz = z - lens.z;
      const along = Math.min(1, Math.max(0, (px * sight.x + py * sight.y + pz * sight.z) / sightLength ** 2));
      const off = Math.hypot(px - sight.x * along, py - sight.y * along, pz - sight.z * along);
      const clearing = config.clearView * (ballRadius / 0.27);
      const clear = clearing > 0 && arrived > 0 ? smooth(clearing * 0.35, clearing, off) : 1;
      // a loose piece about to touch the lens would cross the frame in a frame or two,
      // which reads as a flash, so it goes before it gets there
      const gap = Math.hypot(px, py, pz) - radii[i];
      const atLens = config.lensClear > 0 && arrived > 0 ? smooth(0.03, config.lensClear, gap) : 1;
      const k = i * 12;
      data[k] = x;
      data[k + 1] = y;
      data[k + 2] = z;
      data[k + 3] = (1 + (closed[i] - 1) * (1 - arrived)) * clear * atLens * fade;
      data[k + 4] = q0.x;
      data[k + 5] = q0.y;
      data[k + 6] = q0.z;
      data[k + 7] = q0.w;
      data[k + 8] = arrived;
    }
    slot.since.value = time - glass.hit;
    slot.thickness.value = glass.thick;
    slot.state.needsUpdate = true;
  };

  (window as unknown as { __hitPhases: () => number[] }).__hitPhases = () =>
    hits.map((hit, index) => (index + curves[index].phaseOf(contactOf(hit))) / HITS);
  // where the camera is against what's standing, for checking a camera path
  (window as unknown as { __shot: () => unknown }).__shot = () => ({
    camera: camera.position.toArray(),
    ball: ball.position.toArray(),
    walls: slabs.filter((item) => item.slab.visible).map((item) => item.slab.position.z),
    rig: [rig.azimuth, rig.elevation, rig.distance],
  });

  const paneOf = (pane: number) => hits[((pane % HITS) + HITS) % HITS];
  /** sim seconds into a pane's shot when the ball is at z */
  const shotTime = (glass: Glass, pane: number, z: number) =>
    glass.hit + (-pane * SPACING + glass.thick / 2 + ballRadius - z) / ballSpeed;

  let started = false;
  stage.onFrame(({ phase }) => {
    const tint = new Color(config.glass);
    const absorb = (level: number) => (-Math.log(Math.max(level, 0.002)) / 0.45) * config.depth;
    blue.value.set(absorb(tint.r), absorb(tint.g), absorb(tint.b));
    const solid = config.background !== "tile room";
    backdrop.value.set(config.backdrop);
    showTiles.value = solid ? 0 : 1;
    reflected.value = solid ? config.reflected : 1;
    through.value = solid ? config.glow : 1;
    const stone = config.walls !== "glass";
    insideOn.value = config.walls === "stone, coloured inside" ? 1 : 0;
    insideColour.value.set(config.inside);
    insideGlow.value = config.insideGlow;
    crackSpeed.value = config.crackSpeed;
    ringSpeed.value = config.ringSpeed;

    const stretch = Math.min(HITS - 1, Math.floor(phase * HITS));
    const g = curves[stretch].at(phase * HITS - stretch);
    const travelled = stretch + g; // in panes
    // the ball is just touching at the centre of the slow part
    const z = ballRadius + 0.1 - SPACING * (travelled - startProgress);
    ball.position.set(impact[0], impact[1], z);
    ballCentre.value.copy(ball.position);
    room.position.z = z; // tiles come from world position, so the corridor just never ends
    if (!started) lastBall.copy(ball.position);
    started = true;

    if (isAuto()) {
      // Timed by the clock, not the ball: it settles just before a hit, holds, then sets
      // off round the debris while time is still slow. One turn per loop, so the last
      // angle leads to the first
      type Value = (hit: (typeof hits)[number]) => number;
      const keys = (settled: Value, leaving: Value = settled) =>
        hits.flatMap((hit, index): [number, number][] => {
          const at = (index + curves[index].phaseOf(contactOf(hit))) / HITS;
          return [
            [at - 0.4 / stage.loop, settled(hit)],
            [at + hit.hold / stage.loop, leaving(hit)],
          ];
        });
      const azimuth = keyframes(keys((hit) => hit.azimuth - config.drift, (hit) => hit.azimuth + config.drift + hit.sweep), 360)(phase);
      const elevation = keyframes(keys((hit) => hit.elevation), 0)(phase);
      // a bigger ball needs the camera further back, though not twice as far
      const distance =
        keyframes(keys((hit) => hit.distance, (hit) => hit.distance + hit.pull), 0)(phase) * (1 + (ballRadius / 0.27 - 1) * 0.45);
      const aim = keyframes(keys((hit) => hit.aim), 0)(phase);
      controls.target.copy(ball.position);
      controls.target.z -= aim;
      place(azimuth, elevation, distance);
      focus.value = distance;
    } else {
      const moved = offset.subVectors(ball.position, lastBall);
      camera.position.add(moved);
      controls.target.add(moved);
      if (move) {
        const t = smooth(0, 1, (performance.now() - move.start) / 800);
        const [a, e, d] = move.from.map((from, i) => from + (move!.to[i] - from) * t);
        controls.target.copy(ball.position).addScaledVector(move.pan, 1 - t);
        place(a, e, d);
        if (t === 1) move = null;
      }
      focus.value = camera.position.distanceTo(controls.target);
    }
    // stay in the room: past the walls there's nothing to see
    camera.position.x = Math.min(4.75, Math.max(-4.75, camera.position.x));
    camera.position.y = Math.min(3.25, Math.max(-2.45, camera.position.y));
    camera.lookAt(controls.target);
    lastBall.copy(ball.position);
    offset.subVectors(camera.position, controls.target);
    rig.distance = offset.length();
    rig.azimuth = (toDegrees(Math.atan2(offset.x, offset.z)) + 360) % 360;
    rig.elevation = toDegrees(Math.asin(offset.y / rig.distance));

    lens.copy(camera.position);
    sight.subVectors(ball.position, lens);
    sightLength = sight.length() || 1;
    // each hit's shards: the latest pane of its kind the ball has reached
    const next = Math.floor(travelled);
    slots.forEach((slot, index) => {
      const glass = glasses[slot.hit.glass];
      let pane = next + 1 - ((((next + 1 - index) % HITS) + HITS) % HITS);
      if (shotTime(glass, pane, z) < glass.hit) pane -= HITS;
      const time = shotTime(glass, pane, z);
      const live = time < glass.lifetime;
      slot.mesh.visible = live;
      slot.back.visible = live && !stone;
      if (live) pose(slot, glass, time, pane);
    });
    slabs.forEach((item, index) => {
      const pane = next + index;
      const name = paneOf(pane).glass;
      const glass = glasses[name];
      const standing = shotTime(glass, pane, z) < glass.hit;
      item.glass = name;
      item.slab.visible = standing;
      item.back.visible = standing && !stone;
      item.slab.geometry = item.back.geometry = glass.slab;
      item.back.material = slabSets[name].back;
      item.slab.position.z = item.back.position.z = -pane * SPACING;
    });

    focal.value = config.focus;
    bokeh.value = config.bokeh;

    // what the ball sees, without itself and with the cheap glass
    ball.visible = false;
    room.material = roomInReflections;
    for (const slot of slots) slot.mesh.material = stone ? slot.stone : slot.set.cheap;
    for (const { slab, glass } of slabs) slab.material = stone ? stoneSlab : slabSets[glass].cheap;
    ballCamera.position.copy(ball.position);
    ballCamera.update(renderer, scene);
    ball.visible = true;
    room.material = roomMaterial;
    for (const slot of slots) slot.mesh.material = stone ? slot.stone : slot.set.main;
    for (const { slab, glass } of slabs) slab.material = stone ? stoneSlab : slabSets[glass].main;

    // back faces first: the glass reads their normals and distance
    renderer.getDrawingBufferSize(size);
    if (backs.width !== size.x || backs.height !== size.y) backs.setSize(size.x, size.y);
    camera.updateMatrixWorld();
    renderer.setRenderTarget(backs);
    renderer.render(backScene, camera);
    renderer.setRenderTarget(null);
  });
}
