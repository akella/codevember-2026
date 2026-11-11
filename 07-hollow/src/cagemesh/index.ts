// The cages again, as real meshes instead of a raymarch: the same zoom, the same holes on the same
// schedule (src/cage/pattern.ts), drawn by the rasteriser. Like spite's day 7, the struts are a surface
// with holes cut in it and thickened into a rounded lip; unlike it, nothing is re-cut on the CPU.
//
// On a sphere, which hole a point is in and how far it is from that hole's border never change; only how
// wide the struts are does. So the mesh is built once: a fine sphere, outer and inner skin, each vertex
// carrying its hole, its soft distance to the hole's border, and that distance's gradient. Each frame the
// vertex shader looks up its hole's strut width (the table the raymarch uses) and pushes the two skins
// apart by the lip's profile; the fragment shader cuts the hole (in the shadow pass too) and works out the
// lip's normal exactly. One geometry, drawn once per cage in view, scaled and turned.
//
// What a mesh can't do as the raymarch does: glass. three's transmission sees only what was drawn opaque
// behind it, so a glass cage bends the glazed cages behind it but not other glass.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import { denoise } from "three/examples/jsm/tsl/display/DenoiseNode.js";
import { smaa } from "three/examples/jsm/tsl/display/SMAANode.js";
import { MeshPhysicalNodeMaterial } from "three/webgpu";
import {
  abs,
  acos,
  fract,
  atan,
  attribute,
  cameraViewMatrix,
  color,
  cos,
  dot,
  exp,
  float,
  Fn,
  If,
  int,
  log,
  Loop,
  max,
  min,
  mix,
  modelWorldMatrix,
  mrt,
  normalView,
  output,
  pass,
  positionLocal,
  positionWorld,
  renderOutput,
  screenUV,
  select,
  sin,
  smoothstep,
  texture,
  textureLoad,
  ivec2,
  uniform,
  uniformArray,
  varying,
  vec2,
  vec3,
  vec4,
  modelWorldMatrixInverse,
  cameraPosition,
  pmremTexture,
  sign,
  Break,
} from "three/tsl";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  FrontSide,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  NearestFilter,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  PostProcessing,
  Quaternion,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  Vector3,
  Vector4,
  WebGPURenderer,
} from "three/webgpu";
import {
  cage,
  EASINGS,
  easeTable,
  FINISHES,
  flattenSwizzles,
  holesOf,
  KINDS,
  LEVELS,
  MAP,
  MOST,
  NEAR,
  nearestMap,
  neighbours,
  ORDERS,
  SECONDS,
  seeds,
  sequence,
  SLOTS,
  strut,
  TILINGS,
  type Finish,
} from "../cage/pattern";

/** cages in this page's loop, each its own form and finish */
const LOOP = 4;
Object.assign(sequence, { cages: LOOP, finishes: ["charcoal", "gold in glass", "sand", "clay"] });

const look = {
  top: "#c9c3bb",
  bottom: "#ece8e2",
  nightTop: "#141217",
  nightBottom: "#2b2725",
  /** 1 a bright studio, 0 night: everything but the lamp dims */
  daylight: 0.85,
  /** a lamp in the middle of the next solid ball, as on the raymarched page */
  lamp: 2,
  lampColour: "#ffb066",
  key: 2.6,
  sky: 1.1,
  reflections: 0.55,
  /** contact shadows, from the screen */
  occlusion: 0.6,
  exposure: 1,
  drift: 0.05,
  fov: 55,
  /** how finely the sphere is divided: the lips' smoothness, against the triangles drawn */
  detail: 128,
  shadows: true,
  /** pixels drawn per screen pixel */
  resolution: 1,
  /** how many times each of the face's triangles is split in four: its lips' smoothness */
  faceSplits: 1,
  /** gold in glass: the glass over the gold (share of the wall), the gold's roughness, the frost */
  shell: 0.6,
  goldRough: 0.22,
  frost: 0.55,
  /** how milky the frosted glass is: light it scatters back itself, over the gold */
  haze: 0.25,
  /** one glaze inside and out, or two */
  twoTone: false,
};
/** what each cage of the loop is made as, by slot, alongside what it's made of */
const FORMS = ["sphere", "face", "venus"] as const;
const forms: (typeof FORMS)[number][] = ["sphere", "sphere", "face", "sphere"];
/**
 * What each cage's holes are: Voronoi cells, or a pattern drawn by a formula of direction, which the
 * vertex and the fragment shader both work out for themselves: a truchet maze, one ribbon peeling from
 * pole to pole, rings rippling out from the hole the camera flies through, or a weave of two spirals.
 */
const PATTERNS = ["voronoi", "truchet", "ribbon", "ripples", "woven"] as const;
type Pattern = (typeof PATTERNS)[number];
const patterns: Pattern[] = ["truchet", "voronoi", "voronoi", "truchet"];
/** each cage's own holes, when its pattern is voronoi: how they're laid out, and how many (voronoi) */
const holeLayouts = Array.from({ length: LOOP }, () => ({ tiling: "voronoi" as keyof typeof TILINGS, holes: 26 }));
const patternLook = {
  /** truchet: cells along a cube face's edge (even, so a cell corner, a gap, faces the camera) */
  cells: 6,
  /** ribbon: turns from pole to pole */
  turns: 7,
  /** ripples: rings from front to back, and how many they travel each cage */
  rings: 9,
  travel: 1.5,
  /** woven: strands of each hand, and how far they ride over and under each other, in walls */
  strands: 5,
  rows: 6,
  lift: 1.4,
  /** the bands' half width when open, against the deepest a gap goes */
  band: 0.42,
};
/** how deep a gap goes in each pattern, in radians: half its spacing */
function deepestOf(p: Pattern) {
  if (p === "truchet") return Math.PI / 4 / Math.max(2, Math.round(patternLook.cells / 2) * 2);
  if (p === "ribbon") return Math.PI / patternLook.turns / 2;
  if (p === "ripples") return Math.PI / patternLook.rings / 2;
  return Math.PI / patternLook.rows / 2;
}

/** a surface to make a cage of: its points and outward normals, in the cage's own space, and its triangles */
interface Surface {
  position: Float32Array;
  normal: Float32Array;
  index: ArrayLike<number>;
}

/** a sphere, finely divided */
function sphereSurface(detail: number): Surface {
  let sphere: BufferGeometry = new IcosahedronGeometry(1, detail);
  sphere.deleteAttribute("normal");
  sphere.deleteAttribute("uv");
  sphere = mergeVertices(sphere);
  const position = (sphere.attributes.position.array as Float32Array).slice();
  for (let i = 0; i < position.length; i += 3) {
    const l = Math.hypot(position[i], position[i + 1], position[i + 2]);
    for (let a = 0; a < 3; a++) position[i + a] /= l;
  }
  return { position, normal: position.slice(), index: sphere.index!.array };
}

/**
 * A baked shape (the face, day 3's scan, by tools/bakeface.mjs; Venus, from the "prepare sdf stream" demo,
 * by tools/prepmesh.mjs): centred on its deepest point, its furthest at 1. Scaled to sit between its
 * neighbours: its nearest skin clear of the cage inside it, its furthest inside the cage outside it. A
 * tall figure (Venus) has little room either way, so where both can't be had, halfway. And turned so it
 * looks at the camera, upright, while it's the ball coming in (one cage in): a cage turns by its place,
 * so the shape is turned back by that much.
 */
function bakedSurface(data: ArrayBuffer, meta: { vertices: number; indices: number; nearest: number }, roomy = 1.25): Surface {
  const n = meta.vertices;
  const position = new Float32Array(data, 0, n * 3).slice();
  const normal = new Float32Array(data, n * 12, n * 3).slice();
  const index = new Uint32Array(data, n * 24, meta.indices);
  const clearInside = (cage.ratio * 1.04) / meta.nearest, clearOutside = 0.97 / cage.ratio;
  const scale = clearInside < clearOutside ? Math.min(clearOutside, (cage.ratio * roomy) / meta.nearest) : (clearInside + clearOutside) / 2;
  const back = new Quaternion().multiplyQuaternions(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -cage.spin), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -cage.tip)).invert();
  const p = new Vector3();
  for (let i = 0; i < n; i++) {
    p.fromArray(position, i * 3).multiplyScalar(scale).applyQuaternion(back).toArray(position, i * 3);
    p.fromArray(normal, i * 3).applyQuaternion(back).toArray(normal, i * 3);
  }
  return { position, normal, index };
}

/**
 * Each triangle split in four, at its edges' middles, `times` times over: finer lips on the face, whose
 * mesh is as fine as the scan it was made from. The new points sit on the old triangles, which is close
 * enough on a face this finely meshed; their holes and border distances are worked out anew from them.
 */
function subdivide(surface: Surface, times: number): Surface {
  let { position, normal, index } = surface;
  for (let k = 0; k < times; k++) {
    const pos = Array.from(position), nor = Array.from(normal), idx: number[] = [];
    const middles = new Map<number, number>();
    const n0 = position.length / 3;
    const middle = (a: number, b: number) => {
      const key = a < b ? a * n0 * 4 + b : b * n0 * 4 + a;
      let m = middles.get(key);
      if (m === undefined) {
        m = pos.length / 3;
        for (let c = 0; c < 3; c++) pos.push((position[a * 3 + c] + position[b * 3 + c]) / 2);
        const nx = normal[a * 3] + normal[b * 3], ny = normal[a * 3 + 1] + normal[b * 3 + 1], nz = normal[a * 3 + 2] + normal[b * 3 + 2];
        const l = Math.hypot(nx, ny, nz) || 1;
        nor.push(nx / l, ny / l, nz / l);
        middles.set(key, m);
      }
      return m;
    };
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      const ab = middle(a, b), bc = middle(b, c), ca = middle(c, a);
      idx.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    position = new Float32Array(pos);
    normal = new Float32Array(nor);
    index = new Uint32Array(idx);
  }
  return { position, normal, index };
}

/**
 * A cage's mesh from a surface: outer skin and inner skin, every vertex with which hole it's in, its soft
 * distance to that hole's border (in radians of direction from the middle, the same soft-min as the
 * raymarch's field) and that distance's gradient, which comes out of the soft-min exactly: the
 * neighbours' plane normals, weighted as the soft-min weights them, laid along the surface.
 */
function cageGeometry(surface: Surface, points: Vector3[], count: number, near: number[], fillet: number) {
  const n = surface.position.length / 3;
  const pos = new Float32Array(n * 6), nor = new Float32Array(n * 6), face = new Float32Array(n * 2), border = new Float32Array(n * 2), hole = new Float32Array(n * 2), slope = new Float32Array(n * 6);
  const d = new Vector3(), ab = new Vector3(), grad = new Vector3(), up = new Vector3();
  for (let v = 0; v < n; v++) {
    d.fromArray(surface.position, v * 3).normalize();
    up.fromArray(surface.normal, v * 3);
    let which = 0, best = -2;
    for (let k = 0; k < count; k++) {
      const c = d.dot(points[k]);
      if (c > best) (best = c), (which = k);
    }
    let sum = 0;
    grad.set(0, 0, 0);
    for (let m = 0; m < NEAR; m++) {
      const j = near[which * NEAR + m];
      if (j < 0) continue;
      ab.subVectors(points[which], points[j]).normalize();
      const e = Math.exp(-d.dot(ab) / fillet);
      sum += e;
      grad.addScaledVector(ab, e);
    }
    const b = -fillet * Math.log(Math.max(sum, 1e-30));
    grad.divideScalar(Math.max(sum, 1e-30));
    // From a change of direction to a step along the surface: a step ds along the surface turns the
    // direction from the middle by its part across the radius, over the radius. So the gradient along
    // the surface is the sphere's, laid along the surface, over the distance from the middle. On a sphere
    // that's the sphere's own; on the face it's what lets a vertex step exactly onto a rim.
    grad.addScaledVector(d, -d.dot(grad));
    grad.addScaledVector(up, -up.dot(grad)).divideScalar(Math.hypot(surface.position[v * 3], surface.position[v * 3 + 1], surface.position[v * 3 + 2]));
    for (const [layer, side] of [
      [0, 1],
      [1, -1],
    ]) {
      const o = layer * n + v;
      pos.set(surface.position.subarray(v * 3, v * 3 + 3), o * 3);
      up.toArray(nor, o * 3);
      face[o] = side;
      border[o] = b;
      hole[o] = which;
      grad.toArray(slope, o * 3);
    }
  }
  // the inner skin faces in: its triangles wound the other way
  const tri = surface.index;
  const indices = new Uint32Array(tri.length * 2);
  indices.set(tri);
  for (let t = 0; t < tri.length; t += 3) {
    indices[tri.length + t] = tri[t] + n;
    indices[tri.length + t + 1] = tri[t + 2] + n;
    indices[tri.length + t + 2] = tri[t + 1] + n;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("normal", new BufferAttribute(nor, 3));
  g.setAttribute("face", new BufferAttribute(face, 1));
  g.setAttribute("border", new BufferAttribute(border, 1));
  g.setAttribute("hole", new BufferAttribute(hole, 1));
  g.setAttribute("slope", new BufferAttribute(slope, 3));
  g.setIndex(new BufferAttribute(indices, 1));
  return g;
}

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas, width, height, pixelRatio }) => {
  if (import.meta.hot) import.meta.hot.dispose(() => wrap.dispose());
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(Math.min(pixelRatio, look.resolution));
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  await renderer.init();
  flattenSwizzles(renderer);

  const scene = new Scene();
  const top = uniform(color(look.top)), bottom = uniform(color(look.bottom));
  scene.backgroundNode = mix(top, bottom, smoothstep(0.0, 1.0, screenUV.y));
  const environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;

  const camera = new PerspectiveCamera(look.fov, width / height, 0.001, 60);
  const sky = new HemisphereLight(0xfff6ee, 0x6d625a, look.sky);
  scene.add(sky);
  const key = new DirectionalLight(0xffffff, look.key);
  key.position.set(-3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 5;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.002;
  const box = key.shadow.camera;
  box.left = box.bottom = -2.2;
  box.right = box.top = 2.2;
  box.near = 0.1;
  box.far = 20;
  scene.add(key);

  // ---- the pattern, as on the raymarched page
  const D = 1;
  let step = -Math.log(cage.ratio);
  const phase = uniform(0);
  const thickness = uniform(cage.thickness);
  const spin = uniform(cage.spin), tip = uniform(cage.tip);
  /**
   * Each cage of the loop has its own holes: their centres, which are neighbours, how deep each is and
   * its turn, and the soft-min's width for them. Laid out on the GPU side by side, one slot after another:
   * centres in one array (slot * MOST + hole), neighbours and the direction-to-hole maps in two textures,
   * a row or a band of rows a slot (each array is a uniform buffer, and a shader gets twelve).
   */
  const cellOf = (count: number) => Math.sqrt((4 * Math.PI) / count);
  const holesFor = (slot: number) => {
    const layout = holeLayouts[slot];
    const first = seeds(layout.tiling, layout.holes, cage.fine, layout.tiling === "voronoi" ? cage.jitter : 0, cage.seed + slot);
    const near = neighbours(first.points, first.count);
    const fillet = cage.fillet * cellOf(first.count);
    return { first, near, fillet, holes: holesOf(first.points, first.count, near, cage.order, cage.seed + slot, fillet) };
  };
  let slotHoles = holeLayouts.map((_, k) => holesFor(k));
  let curveTable = easeTable(cage.easing);
  const centres = Array.from({ length: LOOP * MOST }, () => new Vector3());
  const points = uniformArray(centres, "vec3");
  // neighbours: three vec4s a hole, four to a vec4, each its index (-1: none); in a uniform array, which reads
  // faster than a texture here (a plain float array of them would pass a uniform buffer's 64 KB)
  const nearPacked = Array.from({ length: LOOP * MOST * 3 }, () => new Vector4(-1, -1, -1, -1));
  const nearList = uniformArray(nearPacked, "vec4");
  const nearestData = new Uint8Array(MAP[0] * MAP[1] * LOOP * 4);
  const nearest = new DataTexture(nearestData, MAP[0], MAP[1] * LOOP, RGBAFormat, UnsignedByteType);
  nearest.minFilter = nearest.magFilter = NearestFilter;
  nearest.generateMipmaps = false;
  /** a slot's holes onto the GPU */
  const upload = (slot: number) => {
    const { first, near } = slotHoles[slot];
    for (let h = 0; h < MOST; h++) centres[slot * MOST + h].copy(first.points[h]);
    for (let h = 0; h < MOST; h++)
      for (let q = 0; q < 3; q++) {
        const at = h * NEAR + q * 4;
        nearPacked[(slot * MOST + h) * 3 + q].set(near[at] ?? -1, near[at + 1] ?? -1, near[at + 2] ?? -1, near[at + 3] ?? -1);
      }
    nearestData.set(nearestMap(first.points, first.count), slot * MAP[0] * MAP[1] * 4);
    nearest.needsUpdate = true;
  };
  slotHoles.forEach((_, k) => upload(k));
  // every hole's strut in every cage in view, worked out each frame
  const widths = uniformArray(new Array(LEVELS * MOST).fill(1), "float");
  const firstLevel = uniform(0);
  // per slot of the loop: (kind, glow, 0, 0) and (outside colour, 0), for the lamp through other cages
  const slotA = Array.from({ length: SLOTS }, () => new Vector4()), slotB = Array.from({ length: SLOTS }, () => new Vector4());
  const slotsA = uniformArray(slotA, "vec4"), slotsB = uniformArray(slotB, "vec4");
  const slots = uniform(sequence.cages);

  // ---- each cage drawn: which it is, and what it's made of, from the mesh it's drawn as
  interface Drawn {
    level: number;
    pattern: Pattern;
    /** the weave's other hand, drawn as a mesh of its own */
    otherHand?: boolean;
    finish: Finish;
    outside: Color;
    inside: Color;
  }
  const own = (object: { userData: object }) => object.userData as Drawn;
  const level = uniform(0).onObjectUpdate(({ object }) => own(object!).level);
  const outsideColour = uniform(new Color()).onObjectUpdate(({ object }) => own(object!).outside);
  const insideColour = uniform(new Color()).onObjectUpdate(({ object }) => own(object!).inside);
  const roughness = uniform(0.5).onObjectUpdate(({ object }) => own(object!).finish.roughness);
  const coat = uniform(0).onObjectUpdate(({ object }) => own(object!).finish.coat);
  const metal = uniform(0).onObjectUpdate(({ object }) => (own(object!).finish.kind === "metal" ? 1 : 0));
  const glow = uniform(0).onObjectUpdate(({ object }) => own(object!).finish.glow);
  const ior = uniform(1.45).onObjectUpdate(({ object }) => own(object!).finish.ior);
  const density = uniform(6).onObjectUpdate(({ object }) => own(object!).finish.density);
  const patternOf = uniform(0).onObjectUpdate(({ object }) => (own(object!).otherHand ? 5 : PATTERNS.indexOf(own(object!).pattern)));
  const voronoi = patternOf.equal(0);
  /** which slot of the loop cage k is */
  const slotOf = (k: any) => int(k.sub(k.div(slots).floor().mul(slots)));
  const cells = uniform(6), turns = uniform(7), rings = uniform(9), travel = uniform(1.5), strands = uniform(5), rows = uniform(6), lift = uniform(1.4);

  /**
   * A pattern's field at a direction (in the cage's own space) for cage place u: x how far it is to the
   * nearest of the pattern's material (radians), y the weave's over and under, in walls. Each is laid so a
   * gap faces the camera (+z) as it passes through.
   */
  const fieldOf = Fn(([dir, u, which]: [any, any, any]) => {
    const longitude = atan(dir.x, dir.z); // 0 towards the camera
    const latitude = dir.y.clamp(-1, 1).asin();
    const band = (x: any) => abs(fract(x.add(0.5)).sub(0.5));
    // truchet: the sphere as a cube, each face in cells of equal angle, each cell a quarter-arc tile, turned
    // one way or the other by a hash of where it is
    const ax = abs(dir);
    const onX = ax.x.greaterThanEqual(ax.y).and(ax.x.greaterThanEqual(ax.z));
    const onY = onX.not().and(ax.y.greaterThanEqual(ax.z));
    const major = select(onX, dir.x, select(onY, dir.y, dir.z));
    const across = vec2(select(onX, dir.y, select(onY, dir.z, dir.x)), select(onX, dir.z, select(onY, dir.x, dir.y)));
    const grid = vec2(atan(across.x, abs(major)), atan(across.y, abs(major))).mul(4 / Math.PI).add(1).mul(0.5).mul(cells);
    const cell = grid.floor();
    const side = select(onX, float(0), select(onY, float(1), float(2))).add(select(major.lessThan(0), float(3), float(0)));
    const flip = fract(sin(dot(cell, vec2(12.9898, 78.233)).add(side.mul(37.719))).mul(43758.5453)).greaterThan(0.5);
    const f0 = fract(grid);
    const f = vec2(select(flip, f0.x.oneMinus(), f0.x), f0.y);
    const truchet = min(abs(f.length().sub(0.5)), abs(f.sub(1).length().sub(0.5))).mul(Math.PI / 2).div(cells);
    // ribbon: one spiral from pole to pole
    const ribbonGap = float(Math.PI).div(turns);
    const ribbon = band(latitude.div(ribbonGap).add(longitude.div(Math.PI * 2)).add(0.5)).mul(ribbonGap);
    // ripples: rings round the camera's way, travelling out as the cage grows
    const ringGap = float(Math.PI).div(rings);
    const ripples = band(acos(dir.z.clamp(-1, 1)).div(ringGap).sub(u.mul(travel)).add(0.5)).mul(ringGap);
    // woven: a spiral of each hand, strands crossing; each strand rides over one and under the next
    const rowGap = float(Math.PI).div(rows);
    const s1 = latitude.div(rowGap).add(longitude.div(Math.PI * 2).mul(strands)).add(0.5);
    const s2 = latitude.div(rowGap).sub(longitude.div(Math.PI * 2).mul(strands)).add(0.5);
    const d1 = band(s1).mul(rowGap), d2 = band(s2).mul(rowGap);
    const h1 = cos(s2.add(s1.round()).mul(Math.PI)), h2 = cos(s1.add(s2.round()).mul(Math.PI)).negate();
    // Each hand of the weave is a mesh of its own (4 the one, 5 the other), with only its own strands,
    // rising and dipping on a smooth wave (h1, h2): crossing strands are two tubes, one passing over the
    // other. On one surface, the strand going under had to drop off a cliff at the edge of the other.
    const b = select(which.equal(1), truchet, select(which.equal(2), ribbon, select(which.equal(3), ripples, select(which.equal(4), d1, d2))));
    return vec2(b, select(which.equal(4), h1, select(which.equal(5), h2, float(0))).mul(lift));
  });

  // the struts round this vertex's hole in this cage, and the lip they make: from the mesh's own values for
  // Voronoi cages, from the pattern's formula for the others, with its slope along the surface by small steps
  const face = attribute("face", "float"), surfaceNormal = attribute("normal", "vec3");
  const levelRow = int(level.sub(firstLevel).clamp(0, LEVELS - 1)).mul(MOST);
  const along = () => {
    const p = positionLocal;
    const n = surfaceNormal.normalize();
    const t1 = select(abs(n.y).lessThan(0.9), vec3(0, 1, 0), vec3(1, 0, 0)).cross(n).normalize();
    const t2 = n.cross(t1);
    const e = float(0.002);
    const u = phase.sub(level);
    const here = fieldOf(p.normalize(), u, patternOf);
    const b1 = fieldOf(p.add(t1.mul(e)).normalize(), u, patternOf);
    const b2 = fieldOf(p.add(t2.mul(e)).normalize(), u, patternOf);
    // x, y, z the border distance's slope along the surface, w the distance; and the lift's slope
    return { field: vec4(t1.mul(b1.x.sub(here.x)).add(t2.mul(b2.x.sub(here.x))).div(e), here.x), lift: vec4(t1.mul(b1.y.sub(here.y)).add(t2.mul(b2.y.sub(here.y))).div(e), here.y) };
  };
  const analytic = along();
  const border = select(voronoi, attribute("border", "float"), analytic.field.w);
  const slope = select(voronoi, attribute("slope", "vec3"), analytic.field.xyz);
  const strutHere = widths.element(levelRow.add(select(voronoi, int(attribute("hole", "float")), int(MOST - 1))));
  const liftHere = select(voronoi, float(0), analytic.lift.w);
  const liftSlope = varying(select(voronoi, vec3(0), analytic.lift.xyz), "vLiftSlope");
  const slopeHere = varying(slope, "vSlope");
  /** half the wall's thickness at a border distance, for struts of width w: full, a rounded lip, or none */
  const profile = (b: any, w: any) => {
    const round = min(thickness, w);
    const qy = b.sub(w).add(round);
    const lip = thickness.sub(round).add(round.mul(round).sub(qy.mul(qy)).max(0).sqrt());
    return select(qy.lessThanEqual(0), thickness, select(qy.lessThan(round), lip, float(0)));
  };
  // Vertices just inside a hole slide back along the border distance's gradient onto the rim, so the rim
  // runs through vertices and comes out clean, however the triangles lie (the CPU way, spite's, is to cut
  // triangles along it). How far back they're taken from: a lip's width, or a few triangles if more.
  const snapZone = uniform(0.03);
  const rimmed = Fn(() => {
    const beyond = border.sub(strutHere);
    const snap = beyond.greaterThan(0).and(beyond.lessThan(snapZone));
    // One Newton step along the border distance's gradient on the surface: exactly onto the rim, to first
    // order. Never further than the snap zone, though: at a hole's very middle the gradient is next to
    // nothing, and the step would fling the vertex across the cage.
    const strength = slope.length().max(1e-6);
    const reach = beyond.div(strength).min(snapZone.mul(positionLocal.length()));
    const moved = positionLocal.sub(slope.div(strength).mul(select(snap, reach, float(0))));
    return vec4(moved, select(snap, strutHere, border));
  })();
  const borderMoved = rimmed.w;
  // each skin off the surface, along its normal, by half the wall there
  // The wall thins to nothing a triangle or so before the true rim. The fragment cuts the hole at the true
  // rim, exactly, and the mesh's wall is only nothing at its vertices: cut between them, the two skins
  // stood apart and showed a slit along every lip. Thinned early, they've met by the time the cut comes.
  const rimFlat = uniform(0.013);
  // the weave rides over and under: both skins lifted together, by walls
  const positionNode = Fn(() => rimmed.xyz.add(surfaceNormal.mul(face.mul(profile(borderMoved.add(rimFlat), strutHere)).add(liftHere.mul(thickness)))))();
  /**
   * Which hole a direction (in the cage's own space) is in, and how far it is to that hole's border, in
   * radians, worked out exactly as the raymarch's field does: the hole looked up, then its neighbours'
   * bisecting planes, softly the nearest.
   */
  const holeAt = Fn(([dir, slot]: [any, any]) => {
    const fillet = slotsA.element(slot).w;
    const lookup = vec2(atan(dir.z, dir.x).div(Math.PI * 2).add(0.5), acos(dir.y.clamp(-1, 1)).div(Math.PI).add(float(slot)).div(LOOP));
    const which = int(texture(nearest, lookup).level(float(0)).r.mul(255).round());
    const base = slot.mul(MOST);
    const a = points.element(base.add(which));
    const sum = float(0).toVar();
    // the hole's twelve neighbours, in three vec4s: read once, not once a neighbour
    const row = base.add(which).mul(3);
    const t0 = nearList.element(row).toVar();
    const t1 = nearList.element(row.add(1)).toVar();
    const t2 = nearList.element(row.add(2)).toVar();
    Loop(NEAR, ({ i }) => {
      const q = i.div(4);
      const texel = select(q.equal(0), t0, select(q.equal(1), t1, t2));
      const k = i.mod(4);
      const j = select(k.equal(0), texel.x, select(k.equal(1), texel.y, select(k.equal(2), texel.z, texel.w)));
      If(j.greaterThanEqual(0), () => {
        // added as floats and then turned whole: TSL dropped an int() round j itself, leaving i32 + f32
        const ab = a.sub(points.element(int(float(base).add(j).round())));
        sum.addAssign(exp(dot(dir, ab).div(ab.length()).negate().div(fillet)));
      });
    });
    return vec2(log(sum.max(1e-30)).mul(fillet).negate(), float(which));
  });
  // In the fragment: where in the lip this point is, worked out again exactly for this point, so the hole
  // is cut along its true curve to the pixel, however the triangles lie. The mesh always reaches past the
  // true rim (the chords between rim vertices cut across the hole), so there's geometry to cut it from.
  // Everywhere, not only near rims: where the cheap interpolated value gave way to the exact one, it drew
  // a line.
  const onSurface = varying(rimmed.xyz, "vSurface");
  const nearRim = Fn(() => {
    // from the point on the surface, before the skins are pushed off it: on the face they're pushed along
    // its normal, not out from the middle, so the pushed point looks the other way, and the two skins
    // would cut their lips at different places
    const dir = onSurface.normalize();
    const here = vec2(fieldOf(dir, phase.sub(level), patternOf).x, widths.element(levelRow.add(MOST - 1))).toVar();
    If(voronoi, () => {
      const hole = holeAt(dir, slotOf(level));
      here.assign(vec2(hole.x, widths.element(levelRow.add(int(hole.y)))));
    });
    return here;
  })().toVar("nearRim");
  const borderHere = nearRim.x;
  const w = nearRim.y;
  const round = min(thickness, w);
  const qy = borderHere.sub(w).add(round);
  // a cage faded to nothing shows nothing: at a hole's corners the soft border distance dips below zero,
  // and left a speck at every joint of a cage whose struts had gone
  const kept = qy.lessThan(round).and(w.greaterThan(1e-5));
  // The lip's normal, exactly: the skin's own (out from the middle, or in) tilted towards the hole by the
  // profile's slope along the border distance's gradient; at the rim it lies flat, into the hole.
  /** the lip's normal in the cage's own space */
  const lipNormal = () => {
    const up = surfaceNormal.normalize();
    const g = slopeHere.sub(up.mul(dot(up, slopeHere))).normalize();
    const across = qy.clamp(0, round);
    const lip = up.mul(face).mul(round.mul(round).sub(across.mul(across)).max(1e-9).sqrt()).add(g.mul(across)).normalize();
    // the weave's rise and fall tilts it, as a surface lifted by L(x) has the normal n - grad L
    return lip.sub(face.mul(liftSlope).mul(thickness)).normalize();
  };
  const normalNode = Fn(() => cameraViewMatrix.mul(vec4(modelWorldMatrix.mul(vec4(lipNormal(), 0)).xyz, 0)).xyz.normalize())();

  // ---- the lamp, as on the raymarched page: along radii from the middle, through the cages in between
  const lampPower = uniform(look.lamp), lampColour = uniform(color(look.lampColour));
  const ratioLog = uniform(step);
  /** a direction turned into cage u's own frame */
  const unturn = (p: any, u: any) => {
    const a = spin.mul(u).negate(), b = tip.mul(u).negate();
    const x1 = p.x.mul(cos(a)).sub(p.y.mul(sin(a)));
    const y1 = p.x.mul(sin(a)).add(p.y.mul(cos(a)));
    return vec3(x1.mul(cos(b)).add(p.z.mul(sin(b))), y1, p.z.mul(cos(b)).sub(x1.mul(sin(b))));
  };
  /** what of the lamp gets through cage k along a direction out from the middle */
  const passes = Fn(([dir, k]: [any, any]) => {
    const local = unturn(dir, phase.sub(k));
    const slot = slotsA.element(slotOf(k));
    const row = int(k.sub(firstLevel).clamp(0, LEVELS - 1)).mul(MOST);
    const hole = holeAt(local, slotOf(k));
    const drawn = fieldOf(local, phase.sub(k), int(slot.z));
    const otherHand = fieldOf(local, phase.sub(k), int(5));
    const drawnBorder = select(slot.z.equal(4), min(drawn.x, otherHand.x), drawn.x);
    const isVoronoi = slot.z.equal(0);
    const width = widths.element(row.add(select(isVoronoi, int(hole.y), int(MOST - 1))));
    const half = profile(select(isVoronoi, hole.x, drawnBorder), width).div(thickness);
    return select(slot.x.equal(1), slotsB.element(slotOf(k)).xyz.pow(vec3(half)), vec3(slot.y.max(1e-4).pow(half)));
  });
  /** the lamps' light here: this cage's own lamp and the two inside it, through every wall between */
  const lampLight = Fn(([n]: [any]) => {
    const p = positionWorld;
    const r = p.length();
    const dir = p.div(r);
    const outside = face.greaterThan(0);
    // through its own wall when lit from behind: as thick as the wall is here
    const ownHalf = profile(border, w).div(thickness);
    const through = select(outside, vec3(glow.max(1e-4).pow(ownHalf)), vec3(1)).toVar();
    const light = vec3(0).toVar();
    Loop(3, ({ i }) => {
      const k = level.add(float(i));
      If(i.greaterThan(0), () => {
        through.mulAssign(passes(dir, k));
      });
      const u = phase.sub(k);
      const size = exp(u.mul(ratioLog)).mul(D);
      const on = smoothstep(-2.4, -1.4, u).mul(smoothstep(-0.6, 0.4, u).oneMinus());
      light.addAssign(through.mul(on.mul(size.mul(size)).div(r.mul(r))));
    });
    const facing = dot(n, dir.negate());
    return light.mul(lampPower).mul(lampColour).mul(select(outside, float(0.7), facing.max(0)));
  });

  // Which glaze, by how far out from the middle of the wall the point is, as the raymarch has it, not by
  // which skin it's on: both skins come to the middle of the wall at the rim, so they blend to the same
  // colour there, and a triangle folded over by the rim snap can't show the other skin's colour.
  const twoTone = uniform(look.twoTone ? 1 : 0);
  const base = mix(outsideColour, mix(insideColour, outsideColour, smoothstep(-0.3, 0.3, face.mul(profile(borderHere, w)).div(thickness))), twoTone);
  const worldNormal = Fn(() => modelWorldMatrix.mul(vec4(lipNormal(), 0)).xyz.normalize())();

  /** what every cage material shares: the moving skin, the holes cut (in shadows too), the lip's normal */
  const shape = (m: MeshPhysicalNodeMaterial) => {
    // One side is enough: a triangle folded over where vertices slid onto a rim is culled and shows the
    // other skin behind it, but that is the same colour there now (glaze by place in the wall, not by
    // skin). Drawing both sides hid the folds as well, for a fifth more time a frame.
    m.side = FrontSide;
    m.positionNode = positionNode;
    m.maskNode = kept;
    m.castShadowNode = vec4(0, 0, 0, select(kept, float(1), float(0)));
    m.alphaTest = 0.5;
    m.normalNode = normalNode;
    m.clearcoatNormalNode = normalNode;
    return m;
  };
  // glaze and metal
  const solid = shape(new MeshPhysicalNodeMaterial());
  solid.colorNode = base;
  solid.roughnessNode = roughness;
  solid.metalnessNode = metal;
  solid.clearcoatNode = coat;
  solid.clearcoatRoughnessNode = float(0.22);
  solid.emissiveNode = base.mul(lampLight(worldNormal)).mul(metal.oneMinus());
  // glass, with three's transmission: it sees what was drawn opaque behind it
  const glass = shape(new MeshPhysicalNodeMaterial({ transmission: 1, roughness: 0.02, metalness: 0 }));
  glass.colorNode = color(0xffffff);
  glass.iorNode = ior;
  glass.thicknessNode = thickness.mul(2).mul(modelWorldMatrix.element(int(0)).xyz.length());
  glass.attenuationColorNode = outsideColour;
  glass.attenuationDistanceNode = float(1).div(density.max(0.01)).mul(modelWorldMatrix.element(int(0)).xyz.length());

  // Gold in glass, as in the "prepare sdf stream" demo (frosted.glsl): each strut frosted glass with a gold
  // core, the same strut inset by the shell. There the statue's 3D field gave both; here a strut's cross
  // section is known exactly instead (the lip's profile across it, by border distance; its thickness up
  // and down), so the refracted ray is walked through that, laid flat on the surface where it enters:
  // across the strut is the border distance's slope, up the surface normal. The noise-free cone of the
  // demo: one ray widening with distance, its closest approach to the gold over its width saying how
  // much of the gold it covers, so gold deep in the glass blurs.
  const shell = uniform(0.35), goldRough = uniform(0.22), frost = uniform(0.35), keyLightDir = uniform(new Vector3(-3, 5, 4).normalize());
  const envStrength = uniform(look.reflections), keyStrength = uniform(look.key);
  /** the room's light from a direction, blurred by roughness, as bright as the scene has it */
  const env = (dir: any, rough: any) => pmremTexture(environment, dir, rough).rgb.mul(envStrength);
  /** a light's highlight, GGX */
  const highlight = (n: any, v: any, rough: any, l: any) => {
    const h = l.add(v).normalize();
    const a = rough.mul(rough).max(0.002), a2 = a.mul(a);
    const nh = dot(n, h).max(0), nl = dot(n, l).max(0), nv = dot(n, v).max(1e-3);
    const dist = a2.div(nh.mul(nh).mul(a2.sub(1)).add(1).pow(2).mul(Math.PI));
    const vis = float(0.5).div(nl.mul(nv.mul(nv).mul(a2.oneMinus()).add(a2).sqrt()).add(nv.mul(nl.mul(nl).mul(a2.oneMinus()).add(a2).sqrt())).max(1e-5));
    return dist.mul(vis).mul(nl);
  };
  /** half the gold core's thickness at border distance b: the strut's profile, inset by the shell */
  const goldProfile = (b: any, w: any) => {
    const inset = thickness.mul(shell);
    const th = thickness.sub(inset), wg = w.sub(inset);
    const r = min(th, wg).max(1e-5);
    const qy = b.sub(wg).add(r);
    const lip = th.sub(r).add(r.mul(r).sub(qy.mul(qy)).max(0).sqrt());
    return select(wg.lessThanEqual(0), float(-1), select(qy.lessThanEqual(0), th, select(qy.lessThan(r), lip, float(-1))));
  };
  const toWorld = (v: any) => modelWorldMatrix.mul(vec4(v, 0)).xyz.normalize();
  const goldInGlass = Fn(() => {
    const p = positionLocal;
    const camera = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
    const v = camera.sub(p).normalize();
    const n = lipNormal();
    const eta = float(1).div(ior);
    const rd0 = v.negate().refract(n, eta);
    const rd = select(dot(rd0, rd0).lessThan(1e-6), v.negate(), rd0.normalize());
    const up = surfaceNormal.normalize();
    const across = slopeHere.sub(up.mul(dot(up, slopeHere)));
    const acrossUnit = across.normalize();
    // the strut's cross section along the ray: s across (border distance, past the border on the other
    // side), y up through the wall
    const ds = dot(rd, across), dy = dot(rd, up);
    const s0 = borderHere, y0 = face.mul(profile(borderHere, w));
    const spread = frost.mul(eta.oneMinus()).add(1e-3);
    const t = thickness.mul(0.05).toVar();
    const best = float(1e9).toVar(), tBest = float(0).toVar(), hit = float(0).toVar();
    Loop(24, () => {
      const b = abs(s0.add(ds.mul(t))), y = abs(y0.add(dy.mul(t)));
      const toGold = y.sub(goldProfile(b, w));
      const toGlass = y.sub(profile(b, w));
      If(toGold.lessThan(0), () => {
        hit.assign(1);
        Break();
      });
      const ratio = toGold.div(spread.mul(t));
      If(ratio.lessThan(best), () => {
        best.assign(ratio);
        tBest.assign(t);
      });
      If(toGlass.greaterThan(0), () => {
        Break();
      });
      t.addAssign(max(min(abs(toGlass), toGold).mul(0.6), thickness.mul(0.04)));
    });
    // the gold where the ray (or the cone round it) met it: its normal from its profile's slope
    const tg = select(hit.greaterThan(0.5), t, tBest);
    const bg = s0.add(ds.mul(tg)), yg = y0.add(dy.mul(tg));
    const e = thickness.mul(0.05);
    const slopeOf = goldProfile(abs(bg).add(e), w).sub(goldProfile(abs(bg).sub(e).max(0), w)).div(e.mul(2));
    const ng = toWorld(up.mul(sign(yg)).sub(acrossUnit.mul(sign(bg)).mul(slopeOf)).normalize());
    const rdWorld = toWorld(rd);
    const viewWorld = rdWorld.negate();
    const goldRoughHere = goldRough.add(spread.mul(tg).mul(20)).clamp(0, 1);
    const gold = insideColour;
    const F = gold.add(gold.oneMinus().mul(dot(ng, viewWorld).max(0).oneMinus().pow(5)));
    const lit = env(rdWorld.reflect(ng), goldRoughHere).mul(2).add(highlight(ng, viewWorld, goldRoughHere, keyLightDir).mul(keyStrength));
    const absorb = exp(outsideColour.oneMinus().mul(density).mul(tg).negate().mul(8));
    const goldSeen = F.mul(lit).mul(absorb);
    // past the gold: out the far side, frosted, the room behind
    const behind = env(rdWorld, frost.mul(2).clamp(0, 1)).mul(exp(outsideColour.oneMinus().mul(density).mul(t).negate().mul(8)));
    const covered = select(hit.greaterThan(0.5), float(1), smoothstep(0, 1, best).oneMinus());
    // what comes through the glass's face, less what it reflects (the material reflects that itself)
    const facing = dot(n, v).max(0);
    return mix(behind, goldSeen, covered).mul(float(0.96).sub(facing.oneMinus().pow(5).mul(0.96))).mul(haze.oneMinus());
  })();
  const goldGlass = shape(new MeshPhysicalNodeMaterial({ metalness: 0 }));
  // the frost scatters some light back itself, milky, as the demo's haze
  const haze = uniform(0.25);
  goldGlass.colorNode = outsideColour.mul(haze);
  goldGlass.roughnessNode = frost.mul(0.6);
  goldGlass.emissiveNode = goldInGlass;

  // the cages in view, one mesh each, all the same geometry
  const load = async (name: string) => ({ meta: await (await fetch(`./${name}-mesh.json`)).json(), data: await (await fetch(`./${name}-mesh.bin`)).arrayBuffer() });
  const [faceMesh, venusMesh] = await Promise.all([load("me-256"), load("venus")]);
  const surfaces = () => ({
    sphere: sphereSurface(look.detail),
    face: subdivide(bakedSurface(faceMesh.data, faceMesh.meta), look.faceSplits),
    venus: bakedSurface(venusMesh.data, venusMesh.meta),
  });
  let made = surfaces();
  /** a slot's mesh: its form, with its holes' border distances baked in */
  const geometryFor = (slot: number) => {
    const { first, near, fillet } = slotHoles[slot];
    return cageGeometry(made[forms[slot]], first.points, first.count, near, fillet);
  };
  let geometries = holeLayouts.map((_, k) => geometryFor(k));
  let geometry = geometries[0];
  snapZone.value = Math.max(cage.thickness, 3 * (1.1 / (look.detail + 1)));
  rimFlat.value = 1.5 * (1.1 / (look.detail + 1));
  const cages = Array.from({ length: LEVELS }, () => {
    const m = new Mesh(geometry, solid);
    m.frustumCulled = false;
    m.castShadow = m.receiveShadow = true;
    m.userData = { level: 0, pattern: "voronoi", finish: FINISHES.ceramic, outside: new Color(), inside: new Color() } satisfies Drawn;
    scene.add(m);
    return m;
  });
  // the weave's other hand, one per cage, shown only for woven ones
  const twins = cages.map(() => {
    const m = new Mesh(geometry, solid);
    m.frustumCulled = false;
    m.castShadow = m.receiveShadow = true;
    m.visible = false;
    m.userData = { level: 0, pattern: "woven", otherHand: true, finish: FINISHES.ceramic, outside: new Color(), inside: new Color() } satisfies Drawn;
    scene.add(m);
    return m;
  });

  // ---- picture: contact shadows, then edges smoothed
  const post = new PostProcessing(renderer);
  post.outputColorTransform = false;
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: normalView }));
  const occlusion = ao(scenePass.getTextureNode("depth"), scenePass.getTextureNode("normal"), camera);
  occlusion.resolutionScale = 0.75;
  occlusion.radius.value = 0.4;
  occlusion.thickness.value = 0.25;
  const occlusionAmount = uniform(look.occlusion);
  const smooth = denoise(occlusion.getTextureNode(), scenePass.getTextureNode("depth"), scenePass.getTextureNode("normal"), camera);
  const shaded = vec4(scenePass.getTextureNode("output").rgb.mul(mix(float(1), smooth.r, occlusionAmount)), 1);
  post.outputNode = smaa(renderOutput(shaded));

  // ---- gui
  /** everything again: every slot's holes and meshes (shapes too, as density or nesting may have changed) */
  const reseed = () => {
    made = surfaces();
    slotHoles = holeLayouts.map((_, k) => holesFor(k));
    slotHoles.forEach((_, k) => upload(k));
    curveTable = easeTable(cage.easing);
    for (const g of geometries) g.dispose();
    geometries = holeLayouts.map((_, k) => geometryFor(k));
    snapZone.value = Math.max(cage.thickness, 3 * (1.1 / (look.detail + 1)));
    rimFlat.value = 1.5 * (1.1 / (look.detail + 1));
  };
  /** one slot's holes and mesh again, as its layout or form changed */
  const reslot = (slot: number) => {
    slotHoles[slot] = holesFor(slot);
    upload(slot);
    geometries[slot].dispose();
    geometries[slot] = geometryFor(slot);
  };
  const gui = new GUI({ title: "ceramic cage, meshes" });
  const shapeFolder = gui.addFolder("cage");
  shapeFolder.add(cage, "fine", 1, 3, 1).name("finer (tilings)").onChange(reseed);
  shapeFolder.add(cage, "jitter", 0, 1.5, 0.01).name("uneven holes (voronoi)").onFinishChange(reseed);
  shapeFolder.add(cage, "seed", 1, 100, 1).onFinishChange(reseed);
  shapeFolder.add(cage, "thickness", 0.005, 0.12, 0.001);
  shapeFolder.add(cage, "tube", 0.005, 0.3, 0.001).name("tube width");
  shapeFolder.add(cage, "fillet", 0.005, 0.3, 0.001).name("round corners").onFinishChange(reseed);
  shapeFolder.add(cage, "spin", -3, 3, 0.01).name("spin per cage").onFinishChange(reseed);
  shapeFolder.add(cage, "tip", -3, 3, 0.01).name("tip per cage").onFinishChange(reseed);
  // how finely the spheres are meshed, and how close together the cages nest
  gui.add(look, "detail", 24, 256, 1).name("sphere mesh density").onFinishChange(reseed);
  gui.add(look, "faceSplits", 0, 2, 1).name("face mesh density (splits)").onFinishChange(reseed);
  gui.add(cage, "ratio", 0.25, 0.6, 0.01).name("next cage's size").onFinishChange(reseed);
  const opening = gui.addFolder("opening");
  opening.add(cage as { easing: string }, "easing", [...EASINGS]).onChange(() => (curveTable = easeTable(cage.easing)));
  opening.add(cage, "dimple", 0.05, 0.9, 0.01).name("dimple first (share)");
  opening.add(cage, "stagger", 0, 0.9, 0.01).name("take turns");
  opening.add(cage as { order: string }, "order", [...ORDERS]).name("turns in order").onChange(reseed);
  opening.add(cage, "solid", 0.3, 3, 0.01).name("closed beyond (cages)");
  opening.add(cage, "open", 0, 2, 0.01).name("open by (cages)");
  const materials = gui.addFolder("materials");
  materials.add(sequence, "cages", 1, LOOP, 1).name("cages in the loop").onChange(() => describe());
  for (let k = 0; k < LOOP; k++) {
    materials.add(sequence.finishes, k, Object.keys(FINISHES)).name(`cage ${k + 1}`);
    materials.add(forms, k, [...FORMS]).name(`cage ${k + 1} as`).onChange(() => reslot(k));
    materials.add(patterns, k, [...PATTERNS]).name(`cage ${k + 1} pattern`);
    materials.add(holeLayouts[k] as { tiling: string }, "tiling", Object.keys(TILINGS)).name(`cage ${k + 1} holes as`).onChange(() => reslot(k));
    materials.add(holeLayouts[k], "holes", 4, MOST, 1).name(`cage ${k + 1} points`).onFinishChange(() => reslot(k));
  }
  materials.add(look, "twoTone").name("two glazes, in and out");
  const patternFolder = gui.addFolder("patterns").close();
  patternFolder.add(patternLook, "cells", 2, 16, 2).name("truchet cells");
  patternFolder.add(patternLook, "turns", 2, 20, 0.5).name("ribbon turns");
  patternFolder.add(patternLook, "rings", 3, 24, 1).name("ripple rings");
  patternFolder.add(patternLook, "travel", -4, 4, 0.05).name("ripples travel (rings a cage)");
  patternFolder.add(patternLook, "strands", 1, 12, 1).name("woven strands");
  patternFolder.add(patternLook, "rows", 2, 16, 1).name("woven rows");
  patternFolder.add(patternLook, "lift", 0, 4, 0.05).name("woven over and under");
  patternFolder.add(patternLook, "band", 0.15, 0.62, 0.01).name("band width");
  const goldFolder = gui.addFolder("gold in glass").close();
  goldFolder.add(look, "shell", 0.05, 0.9, 0.01).name("glass over the gold");
  goldFolder.add(look, "goldRough", 0, 1, 0.01).name("gold roughness");
  goldFolder.add(look, "frost", 0, 1, 0.01);
  goldFolder.add(look, "haze", 0, 1, 0.01).name("milky");
  const lampFolder = gui.addFolder("lamp inside");
  lampFolder.add(look, "daylight", 0, 1, 0.01);
  lampFolder.add(look, "lamp", 0, 12, 0.01).name("brightness");
  lampFolder.addColor(look, "lampColour").name("colour");
  const lookFolder = gui.addFolder("light and lens").close();
  lookFolder.add(look, "key", 0, 10, 0.01).name("key light");
  lookFolder.add(look, "sky", 0, 4, 0.01).name("sky light");
  lookFolder.add(look, "reflections", 0, 2, 0.01);
  lookFolder.add(look, "occlusion", 0, 1.5, 0.01);
  lookFolder.add(look, "shadows");
  lookFolder.add(look, "exposure", 0.3, 2, 0.01);
  lookFolder.add(look, "drift", 0, 0.3, 0.001).name("camera drift");
  lookFolder.add(look, "fov", 20, 100, 1).name("lens (fov)");
  gui.add(look, "resolution", 0.25, 2, 0.05);
  const length = gui.add({ loop: "" }, "loop").disable();
  const describe = () => length.setValue(`${SECONDS * sequence.cages} s`);
  describe();
  if (innerWidth < 600) gui.close();

  let held: number | null = null;
  (window as any).__cage = { cage, look, settings: look, sequence, finishes: FINISHES, patterns, forms, patternLook, holeLayouts, camera, hold: (t: number | null) => (held = t), loopSeconds: () => SECONDS * sequence.cages, rebuild: reseed, apply: () => {} };

  let live = 0, lastPlayhead = 0;
  const patternHole = new Vector4();
  const smoothstep01 = (a: number, b: number, x: number) => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
  };
  const swap = new Color(), turnZ = new Quaternion(), turnY = new Quaternion(), zAxis = new Vector3(0, 0, 1), yAxis = new Vector3(0, 1, 0);
  wrap.render = ({ playhead }) => {
    let dp = playhead - lastPlayhead;
    if (dp < -0.5) dp += 1;
    lastPlayhead = playhead;
    live += Math.max(dp, 0) * SECONDS;
    const t = held ?? (live / (SECONDS * sequence.cages)) % 1;
    const ph = t * sequence.cages;
    step = -Math.log(cage.ratio);
    ratioLog.value = step;
    phase.value = ph;
    slots.value = sequence.cages;
    thickness.value = cage.thickness;
    spin.value = cage.spin;
    tip.value = cage.tip;

    // every hole's strut in every cage in view, from 3 in from the one being passed
    const k0 = Math.floor(ph) - 3;
    firstLevel.value = k0;
    const table = widths.array as number[];
    cells.value = Math.max(2, Math.round(patternLook.cells / 2) * 2);
    turns.value = patternLook.turns;
    rings.value = patternLook.rings;
    travel.value = patternLook.travel;
    strands.value = Math.round(patternLook.strands);
    rows.value = patternLook.rows;
    lift.value = patternLook.lift;
    for (let l = 0; l < LEVELS; l++) {
      const k = k0 + l;
      const u = ph - k;
      // Past the camera the cages erode away, their struts thinning to nothing over a couple of cages,
      // so the biggest is gone by the time it's dropped from view, instead of vanishing all at once.
      const fade = 1 - smoothstep01(2.0, 3.85, u);
      const own = slotHoles[((k % sequence.cages) + sequence.cages) % sequence.cages];
      const cell = cellOf(own.first.count);
      for (let h = 0; h < own.first.count; h++) table[l * MOST + h] = strut(u, own.holes[h], curveTable, cell) * fade;
      // the pattern cages: one width for the whole cage, opening on the same schedule as a hole as deep
      const p = patterns[((k % sequence.cages) + sequence.cages) % sequence.cages];
      if (p !== "voronoi") {
        const deep = deepestOf(p);
        patternHole.set(0, deep, 1, 0);
        table[l * MOST + MOST - 1] = strut(u, patternHole, curveTable, (patternLook.band * deep) / cage.tube) * fade;
      }
    }
    for (let k = 0; k < SLOTS; k++) {
      const f = FINISHES[sequence.finishes[k % sequence.finishes.length]];
      slotA[k].set(KINDS.indexOf(f.kind), f.glow, PATTERNS.indexOf(patterns[k % patterns.length]), slotHoles[k % LOOP].fillet);
      swap.set(f.outside);
      slotB[k].set(swap.r, swap.g, swap.b, 0);
    }

    // the cages: each as big and as turned as its place says, made of what its slot says
    cages.forEach((m, l) => {
      const k = k0 + l;
      const u = ph - k;
      const size = D * Math.exp(u * step);
      m.scale.setScalar(size);
      m.quaternion.multiplyQuaternions(turnZ.setFromAxisAngle(zAxis, cage.spin * u), turnY.setFromAxisAngle(yAxis, cage.tip * u));
      const drawn = m.userData as Drawn;
      drawn.level = k;
      drawn.pattern = patterns[((k % sequence.cages) + sequence.cages) % sequence.cages];
      drawn.finish = FINISHES[sequence.finishes[((k % sequence.cages) + sequence.cages) % sequence.cages]];
      drawn.outside.set(drawn.finish.outside);
      drawn.inside.set(drawn.finish.inside);
      m.material = drawn.finish.kind === "glass" ? glass : drawn.finish.kind === "gold glass" ? goldGlass : solid;
      m.geometry = geometries[((k % sequence.cages) + sequence.cages) % sequence.cages];
      m.castShadow = look.shadows;
      // the weave's other hand: the same cage again, its own strands
      const twin = twins[l];
      twin.visible = drawn.pattern === "woven";
      if (twin.visible) {
        twin.scale.copy(m.scale);
        twin.quaternion.copy(m.quaternion);
        twin.geometry = m.geometry;
        twin.material = m.material;
        twin.castShadow = m.castShadow;
        const other = twin.userData as Drawn;
        other.level = k;
        other.finish = drawn.finish;
        other.outside.copy(drawn.outside);
        other.inside.copy(drawn.inside);
      }
    });

    // daylight dims everything but the lamp
    const day = look.daylight;
    key.intensity = look.key * day;
    sky.intensity = look.sky * day;
    scene.environmentIntensity = look.reflections * (0.15 + 0.85 * day);
    top.value.set(look.nightTop).lerp(swap.set(look.top), day);
    bottom.value.set(look.nightBottom).lerp(swap.set(look.bottom), day);
    lampPower.value = look.lamp;
    envStrength.value = scene.environmentIntensity;
    keyStrength.value = key.intensity;
    keyLightDir.value.copy(key.position).normalize();
    shell.value = look.shell;
    goldRough.value = look.goldRough;
    frost.value = look.frost;
    haze.value = look.haze;
    lampColour.value.set(look.lampColour);
    occlusionAmount.value = look.occlusion;
    twoTone.value = look.twoTone ? 1 : 0;
    renderer.toneMappingExposure = look.exposure;

    const a = Math.PI * 2 * t;
    camera.position.set(Math.sin(a) * look.drift * D, Math.sin(2 * a) * 0.6 * look.drift * D, D);
    camera.lookAt(0, 0, 0);
    if (camera.fov !== look.fov) (camera.fov = look.fov), camera.updateProjectionMatrix();
    const ratio = Math.min(pixelRatio, look.resolution);
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    post.render();
  };

  wrap.resize = ({ width, height }) => {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  wrap.unload = () => {
    gui.destroy();
    renderer.dispose();
  };
};

ssam(sketch, {
  mode: "webgpu",
  dimensions: [1080, 1080],
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  animate: true,
  duration: SECONDS * 1000,
  playFps: 60,
  exportFps: 60,
  framesFormat: ["webm"],
} satisfies SketchSettings);
