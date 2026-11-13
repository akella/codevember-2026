// Drawing the run. The light is the same as on the volvox page (everything is light added to black,
// the lens is in every object), copied here so that page stays as it is. What is different: the floor
// is a V, so there are two mirrors, each showing only as far as the fold between them; a body's
// daughters are drawn as discs rather than meshes (they are carried, never squashed); and every size
// is in the measure of the moment, because the world is made four times bigger once a period.
import * as TSL from "three/tsl";
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  FrontSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NodeMaterial,
  OneFactor,
  PerspectiveCamera,
  Scene,
  Vector3,
  Vector4,
} from "three/webgpu";
import { type Ball, H, rng, smooth } from "../volvox/soft.ts";
import { type Cell, F, type Flow, K, RATIO } from "./sim.ts";

export const look = {
  // the camera
  fov: 24,
  pitch: 52, // degrees above the channel
  yaw: 22, // degrees round from square on, towards where they are going
  distance: 34, // in the pack's radii
  rise: 0, // looks this far above the pack's middle
  ahead: 1, // and this far down the channel from it
  aperture: 0.55,
  focusAt: -0.3,
  // the colonies
  cells: 1,
  cellSize: 0.0105,
  cellHalo: 0.5,
  tooth: 0.55,
  farSide: 0.8,
  bokeh: 0.5,
  jelly: 1,
  coat: 0.05,
  daughters: 1,
  stipple: 0.5,
  key: 0.35,
  // a colony bursting
  flash: 2.5,
  fling: 4.2,
  puff: 1.5,
  drag: 3.2,
  fall: 2.0,
  linger: 5,
  // the channel
  mirror: 0.3,
  rough: 0.14,
  deep: 0.12,
  pool: 0.6,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;
const {
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  dot,
  exp,
  float,
  Fn,
  hash,
  If,
  instanceIndex,
  length,
  Loop,
  mix,
  mx_worley_noise_float,
  normalize,
  positionGeometry,
  smoothstep,
  sqrt,
  step,
  uniform,
  uniformArray,
  varying,
  vec2,
  vec3,
  vec4,
}: Record<string, Node> = TSL;

const KEY = new Vector3(-0.5, 0.62, 0.6).normalize();
export const U = {
  focus: uniform(19),
  aperture: uniform(look.aperture),
  pixel: uniform(0.001),
  scale: uniform(1), // the pack's radius, in the measure of the moment
  cells: uniform(look.cells),
  cellHalo: uniform(look.cellHalo),
  tooth: uniform(look.tooth),
  farSide: uniform(look.farSide),
  bokeh: uniform(look.bokeh),
  jelly: uniform(look.jelly),
  coat: uniform(look.coat),
  daughters: uniform(look.daughters),
  stipple: uniform(look.stipple),
  key: uniform(look.key),
  mirror: uniform(look.mirror),
  rough: uniform(look.rough),
  deep: uniform(look.deep),
  pool: uniform(look.pool),
  // how a young one is drawn: where its skin ends, how empty it is inside that, how bright (another page may want it otherwise)
  youngInner: uniform(0.84),
  youngHollow: uniform(0.42),
  youngGain: uniform(1.5),
  keyDir: uniform(KEY.clone()), // where the brighter side faces (another page may turn it with its camera)
};

export const MOST = 24; // bodies that light the walls

function glowing() {
  const m = new NodeMaterial();
  m.transparent = true;
  m.depthTest = false;
  m.depthWrite = false;
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneFactor;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneFactor;
  m.side = DoubleSide;
  return m;
}

const circle = (depth: Node) => U.aperture.mul(depth.sub(U.focus).abs());

// One wall of the channel as a mirror: a plane through the channel's line, and which side of the fold
// the wall itself is on (0: there is no fold, it is a whole floor).
export type Mirror = { n: [number, number, number]; side: number } | null;
const over = (p: Node, m: Mirror) => (m ? dot(p, vec3(...m.n)) : float(0)); // how far a point is above it
const turnIn = (v: Node, m: Mirror) => (m ? v.sub(vec3(...m.n).mul(dot(v, vec3(...m.n)).mul(2))) : v);
// How much of the light of a point behind the mirror reaches the eye: more at a glancing angle, less
// from deeper in (it is not a perfect mirror), and none at all where the line of sight would have to
// pass the fold and go through the other wall's side to get to it.
const shine = (at: Node, m: Mirror) => {
  if (!m) return float(1);
  const n = vec3(...m.n);
  const ray = at.sub(cameraPosition);
  const glance = dot(normalize(ray), n).abs();
  const eye = dot(cameraPosition, n),
    deepness = dot(at, n).negate();
  const where = eye.div(eye.add(deepness).max(1e-6)); // how far along the line of sight the wall is met
  const across = mix(cameraPosition.z, at.z, where).mul(m.side);
  return mix(float(1), float(1).sub(glance).pow(5), float(1).sub(U.mirror))
    .mul(exp(deepness.div(U.scale).mul(U.deep).negate()))
    .mul(m.side ? step(0, across) : float(1))
    .mul(step(0, eye));
};

// (`split`, `big`, `small`: the first `split` cells belong to bodies of `big` cells each, the rest to bodies of `small`.)
export function cellMaterial(mirror: Mirror, split: number, big: number, small: number) {
  const m = glowing();
  const dA: Node = attribute("dA", "vec4"); // where, radius
  const dB: Node = attribute("dB", "vec4"); // which way the skin faces there, brightness
  const corner: Node = positionGeometry.xy;
  const centre = turnIn(dA.xyz, mirror);
  const facing = turnIn(dB.xyz, mirror);
  const cv = cameraViewMatrix.mul(vec4(centre, 1)).xyz;
  const nv = cameraViewMatrix.mul(vec4(facing, 0)).xyz;
  const depth = cv.z.negate().max(1e-4);
  let soft2: Node = circle(depth).pow2().add(depth.mul(U.pixel).mul(0.55).pow2());
  if (mirror) soft2 = soft2.add(over(dA.xyz, mirror).mul(U.rough).pow2());
  const sideways = length(nv.xy);
  const axis = nv.xy.div(sideways.max(1e-4));
  const r0: Node = dA.w;
  const ra = r0.mul(U.tooth.mul(smoothstep(0.55, 1, sideways)).add(1));
  const ea = sqrt(ra.pow2().add(soft2)),
    eb = sqrt(r0.pow2().add(soft2));
  const sharpness = r0.div(eb);
  const REACH = mix(float(1.2), float(2.6), sharpness);
  // Far out of focus a colony's cells are discs many times wider than the gaps between them, dozens
  // deep over every point: a great deal of drawing for a smooth glow. So only a share of them are
  // drawn, each as much brighter: the same light for a fraction of the work. (A cell is about a
  // seventh of the gap to the next across, so sharpness times seven is the gap over the blur.)
  const share = sharpness
    .mul(7)
    .pow2()
    .mul(mirror ? 4 : 8)
    .clamp(mirror ? 0.05 : 0.08, 1);
  // which ones: by a cell's number on its own body, not by where the body happens to be kept, so the
  // same cells are picked for the body in its place a period later
  const own = instanceIndex.lessThan(split).select(instanceIndex.mod(big), instanceIndex.sub(split).mod(small));
  const drawn = step(hash(own), share);
  const lit = dot(facing, U.keyDir).mul(U.key).add(1);
  const back = mix(U.farSide, float(1), smoothstep(-0.25, 0.25, nv.z));
  const gain: Node = r0.pow2().div(ea.mul(eb)).mul(dB.w).mul(lit).mul(back).mul(U.cells).mul(shine(centre, mirror)).mul(drawn).div(share);
  // nothing to show (not picked, hidden behind the fold, switched off): no square at all
  const off = axis.mul(corner.x).mul(ea).add(vec2(axis.y.negate(), axis.x).mul(corner.y).mul(eb)).mul(REACH).mul(step(1e-6, gain));
  m.vertexNode = cameraProjectionMatrix.mul(vec4(cv.add(vec3(off, 0)), 1));
  const q: Node = varying(corner.mul(REACH));
  const power: Node = varying(gain);
  const sharp: Node = varying(sharpness);
  m.fragmentNode = Fn(() => {
    const t = length(q);
    const edge = mix(float(0.1), float(0.45), sharp);
    const disc = float(1).sub(smoothstep(float(1).sub(edge), float(1).add(edge), t));
    const rim = smoothstep(0.5, 1, t).mul(U.bokeh).mul(float(1).sub(sharp)).add(1);
    const halo = exp(t.mul(t).mul(-0.9)).mul(U.cellHalo).mul(sharp);
    const rgb = vec3(0.3, 0.9, 0.14)
      .mul(disc.mul(rim))
      .add(vec3(0.012, 0.2, 0.02).mul(halo));
    return vec4(rgb.mul(power), 1);
  })();
  return m;
}

// The amount of jelly along a line of sight that passes `rho` radii from the middle of a ball, blurred
// by the lens: a ball that is `hollow` inside a skin reaching in to `inner`, with a haze of `fill`.
function jellyAlong(rho: Node, blur: Node, inner: Node, hollow: Node, fill: Node, TAPS = 11) {
  const thick = float(1).sub(inner);
  const wide = thick.add(blur.mul(0.6)).min(0.98);
  const core2 = float(1).sub(wide).pow2();
  const faint = thick.div(wide).mul(hollow);
  const full = float(1).sub(hollow).add(fill);
  let sum: Node = float(0);
  let all = 0;
  for (let k = 0; k < TAPS; k++) all += Math.exp(-2 * ((k / (TAPS - 1)) * 2 - 1) ** 2);
  for (let k = 0; k < TAPS; k++) {
    const o = ((k / (TAPS - 1)) * 2 - 1) * 1.5;
    const w = Math.exp(-2 * (o / 1.5) ** 2) / all;
    const r = rho.add(blur.mul(o)).abs();
    const r2 = r.mul(r);
    const outer = sqrt(float(1).sub(r2).max(0));
    const core = sqrt(core2.sub(r2).max(0));
    sum = sum.add(outer.mul(full).add(outer.sub(core).mul(faint)).mul(w));
  }
  return sum;
}
const YOUNG = [vec3(0.22, 0.95, 0.04), vec3(0.42, 1.0, 0.05)];

// The skin of a body, from a solid young ball to a thin shell with a haze in it as it grows up.
export function jellyMaterial(mirror: Mirror) {
  const m = glowing();
  m.side = mirror ? BackSide : FrontSide;
  const aC: Node = attribute("aC", "vec4"); // middle, radius
  const aD: Node = attribute("aD", "vec4"); // place on the unit ball, seed
  const aE: Node = attribute("aE", "vec2"); // how much of it is there; how far from daughter (0) to colony (1)
  const nrm: Node = attribute("normal", "vec3");
  const cv = cameraViewMatrix.mul(vec4(turnIn(aC.xyz, mirror), 1)).xyz;
  const depth = cv.z.negate().max(1e-4);
  let soft2: Node = circle(depth).pow2().add(depth.mul(U.pixel).pow2());
  if (mirror) soft2 = soft2.add(over(positionGeometry, mirror).max(0).mul(U.rough).pow2());
  const blur = sqrt(soft2).div(aC.w.max(1e-6)).min(3);
  const swell = blur.mul(1.5);
  const at = turnIn(positionGeometry.add(nrm.mul(swell.add(U.coat.mul(aE.y))).mul(aC.w)), mirror);
  m.positionNode = at;
  const wn: Node = varying(turnIn(nrm, mirror)),
    wp: Node = varying(at),
    vBlur: Node = varying(blur),
    vSwell: Node = varying(swell),
    place: Node = varying(aD.xyz),
    seed: Node = varying(aD.w),
    there: Node = varying(aE.x),
    age: Node = varying(aE.y);
  m.fragmentNode = Fn(() => {
    // Most of the cost of a picture is here, so nothing is worked out where nothing will show: behind
    // the fold of a mirror, or a body that is not there.
    const out = vec3(0).toVar();
    const seen = shine(wp, mirror).mul(there);
    If(seen.greaterThan(0.003), () => {
      const eye = normalize(wp.sub(cameraPosition));
      const n = normalize(wn);
      const mu = dot(n, eye).abs();
      const rho = sqrt(float(1).sub(mu.mul(mu)).max(0)).mul(vSwell.add(1));
      const sum = jellyAlong(rho, vBlur, mix(U.youngInner, float(0.925), age), mix(U.youngHollow, float(1), age), mix(float(0), float(0.03), age), mirror ? 7 : 11);
      const lit = dot(n, U.keyDir).mul(U.key).add(1);
      const skinTone = mix(vec3(0.01, 0.4, 0.12), vec3(0.05, 0.8, 0.06), smoothstep(0.1, 0.4, sum));
      // the grain of a young one in focus: looked up only where it can be seen (it is the dearest thing here)
      const grain = float(1).toVar();
      if (!mirror) {
        const near = float(1).sub(smoothstep(0.03, 0.22, vBlur));
        If(near.mul(float(1).sub(age)).greaterThan(0.02), () => {
          const cellsHere = mx_worley_noise_float(place.mul(11).add(seed.mul(31)));
          grain.assign(mix(float(1), smoothstep(0.05, 0.5, cellsHere).mul(0.7).add(0.55), near.mul(U.stipple)));
        });
      }
      const young = mix(YOUNG[0], YOUNG[1], seed).mul(sum).mul(grain).mul(U.daughters).mul(U.youngGain);
      out.assign(mix(young, skinTone.mul(sum).mul(U.jelly).mul(0.45), age).mul(lit).mul(seen));
    });
    return vec4(out, 1);
  })();
  return m;
}

// A daughter still inside her mother: a young ball, drawn as a disc facing the camera, which for a
// ball that is not squashed comes to exactly what the mesh would show.
export function ballMaterial(mirror: Mirror) {
  const m = glowing();
  const iA: Node = attribute("iA", "vec4"); // middle, radius
  const iB: Node = attribute("iB", "vec4"); // seed, brightness, 1 for one too small to bother over (no grain, no reflection)
  const corner: Node = positionGeometry.xy;
  const centre = turnIn(iA.xyz, mirror);
  const cv = cameraViewMatrix.mul(vec4(centre, 1)).xyz;
  const depth = cv.z.negate().max(1e-4);
  let soft2: Node = circle(depth).pow2().add(depth.mul(U.pixel).pow2());
  if (mirror) soft2 = soft2.add(over(iA.xyz, mirror).max(0).mul(U.rough).pow2());
  const blur = sqrt(soft2).div(iA.w.max(1e-6)).min(3);
  const swell = blur.mul(1.5).add(1);
  // (the reflection of one too small to bother over is not drawn at all: a square of no size)
  const size = mirror ? iA.w.mul(float(1).sub(iB.z)) : iA.w;
  m.vertexNode = cameraProjectionMatrix.mul(vec4(cv.add(vec3(corner.mul(size).mul(swell), 0)), 1));
  const q: Node = varying(corner.mul(swell)),
    vBlur: Node = varying(blur),
    seed: Node = varying(iB.x),
    plain: Node = varying(iB.z),
    power: Node = varying(iB.y.mul(shine(centre, mirror))),
    keyView: Node = varying(cameraViewMatrix.mul(vec4(turnIn(U.keyDir, mirror), 0)).xyz);
  m.fragmentNode = Fn(() => {
    const out = vec3(0).toVar();
    If(power.greaterThan(0.003), () => {
      const rho = length(q);
      const sum = jellyAlong(rho, vBlur, U.youngInner, U.youngHollow, float(0), mirror ? 7 : 11);
      // the face of the ball under this point of the disc, as the camera sees it
      const face = vec3(q, sqrt(float(1).sub(rho.mul(rho).min(1))));
      const lit = dot(normalize(face), keyView).mul(U.key).add(1);
      const grain = float(1).toVar();
      if (!mirror) {
        const near = float(1).sub(smoothstep(0.03, 0.22, vBlur));
        If(near.mul(float(1).sub(plain)).greaterThan(0.02), () => {
          const cellsHere = mx_worley_noise_float(face.mul(11).add(seed.mul(31)));
          grain.assign(mix(float(1), smoothstep(0.05, 0.5, cellsHere).mul(0.7).add(0.55), near.mul(U.stipple)));
        });
      }
      out.assign(mix(YOUNG[0], YOUNG[1], seed).mul(sum).mul(grain).mul(lit).mul(U.daughters).mul(U.youngGain).mul(power));
    });
    return vec4(out, 1);
  })();
  return m;
}

// The walls are black. All they show of their own is a little of the light of whatever is near them.
export function wallMaterial(lamps: Node, count: Node) {
  const m = glowing();
  const at: Node = varying(positionGeometry);
  const n: Node = varying(attribute("normal", "vec3"));
  m.fragmentNode = Fn(() => {
    const sum = float(0).toVar();
    Loop(MOST, ({ i }: { i: Node }) => {
      const l = lamps.element(i);
      const d = l.xyz.sub(at);
      const far2 = dot(d, d).max(1e-9);
      // a ball of light: what falls on the wall goes as its size squared over the distance squared, and by how square on it is
      sum.addAssign(
        l.w
          .mul(dot(d, n).max(0))
          .div(far2.mul(sqrt(far2)))
          .mul(float(i).lessThan(count).select(1, 0)),
      );
    });
    return vec4(vec3(0.002, 0.03, 0.005).mul(sum).mul(U.pool), 1);
  })();
  return m;
}

export function dynamic(g: BufferGeometry, name: string, array: Float32Array, size: number, instanced = false) {
  const a = instanced ? new InstancedBufferAttribute(array, size) : new BufferAttribute(array, size);
  a.setUsage(DynamicDrawUsage);
  g.setAttribute(name, a);
  return a;
}

function normals(x: Float32Array, out: Float32Array, mesh: Ball, count: number) {
  const { tris, n } = mesh;
  out.fill(0, 0, count * n * 3);
  for (let b = 0; b < count; b++) {
    const o = b * n * 3;
    for (let t = 0; t < tris.length; t += 3) {
      const i = o + tris[t] * 3,
        j = o + tris[t + 1] * 3,
        k = o + tris[t + 2] * 3;
      const ax = x[j] - x[i],
        ay = x[j + 1] - x[i + 1],
        az = x[j + 2] - x[i + 2];
      const bx = x[k] - x[i],
        by = x[k + 1] - x[i + 1],
        bz = x[k + 2] - x[i + 2];
      const nx = ay * bz - az * by,
        ny = az * bx - ax * bz,
        nz = ax * by - ay * bx;
      out[i] += nx;
      out[i + 1] += ny;
      out[i + 2] += nz;
      out[j] += nx;
      out[j + 1] += ny;
      out[j + 2] += nz;
      out[k] += nx;
      out[k + 1] += ny;
      out[k + 2] += nz;
    }
  }
  for (let i = 0; i < count * n * 3; i += 3) {
    const l = 1 / (Math.sqrt(out[i] * out[i] + out[i + 1] * out[i + 1] + out[i + 2] * out[i + 2]) || 1);
    out[i] *= l;
    out[i + 1] *= l;
    out[i + 2] *= l;
  }
}

// The cells of one kind of body: evenly over the sphere, each pinned to a triangle of the skin.
export interface Pattern {
  count: number;
  tri: Uint16Array;
  w: Float32Array;
  dir: Float32Array;
  size: Float32Array;
  glow: Float32Array;
}
export function pattern(mesh: Ball, count: number, seed: number): Pattern {
  const rand = rng(seed);
  const { dirs, tris } = mesh;
  const nt = tris.length / 3;
  const mids = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) mids[t * 3 + k] = (dirs[tris[t * 3] * 3 + k] + dirs[tris[t * 3 + 1] * 3 + k] + dirs[tris[t * 3 + 2] * 3 + k]) / 3;
  const out = { count, tri: new Uint16Array(count), w: new Float32Array(count * 2), dir: new Float32Array(count * 3), size: new Float32Array(count), glow: new Float32Array(count) };
  const golden = Math.PI * (3 - Math.sqrt(5));
  const gap = Math.sqrt((4 * Math.PI) / count);
  for (let i = 0; i < count; i++) {
    const y = 1 - ((i + 0.5) / count) * 2,
      r = Math.sqrt(1 - y * y),
      a = i * golden;
    let dx = Math.cos(a) * r + (rand() - 0.5) * gap * 0.5,
      dy = y + (rand() - 0.5) * gap * 0.5,
      dz = Math.sin(a) * r + (rand() - 0.5) * gap * 0.5;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= l;
    dy /= l;
    dz /= l;
    let best = 0,
      most = -2;
    for (let t = 0; t < nt; t++) {
      const s = dx * mids[t * 3] + dy * mids[t * 3 + 1] + dz * mids[t * 3 + 2];
      if (s > most) {
        most = s;
        best = t;
      }
    }
    const A = tris[best * 3] * 3,
      B = tris[best * 3 + 1] * 3,
      C = tris[best * 3 + 2] * 3;
    const e1x = dirs[B] - dirs[A],
      e1y = dirs[B + 1] - dirs[A + 1],
      e1z = dirs[B + 2] - dirs[A + 2];
    const e2x = dirs[C] - dirs[A],
      e2y = dirs[C + 1] - dirs[A + 1],
      e2z = dirs[C + 2] - dirs[A + 2];
    const px = dy * e2z - dz * e2y,
      py = dz * e2x - dx * e2z,
      pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    const tx = -dirs[A],
      ty = -dirs[A + 1],
      tz = -dirs[A + 2];
    const qx = ty * e1z - tz * e1y,
      qy = tz * e1x - tx * e1z,
      qz = tx * e1y - ty * e1x;
    out.tri[i] = best;
    out.w[i * 2] = (tx * px + ty * py + tz * pz) / det;
    out.w[i * 2 + 1] = (dx * qx + dy * qy + dz * qz) / det;
    out.dir[i * 3] = dx;
    out.dir[i * 3 + 1] = dy;
    out.dir[i * 3 + 2] = dz;
    out.size[i] = 0.8 + rand() * 0.45;
    out.glow[i] = 0.65 + rand() * 0.7;
  }
  return out;
}
export const chance = (i: number, k: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

interface Skins {
  mesh: Ball;
  cells: Cell[];
  x: Float32Array;
  nrm: Float32Array;
  aC: Float32Array;
  aE: Float32Array;
  attrs: BufferAttribute[];
  each: number; // cells kept for each body
  first: number; // where this pool's cells start in the big list
  ids: Int32Array; // which body each place's cells were last laid out for
}

export class Painter {
  scene = new Scene();
  camera = new PerspectiveCamera(look.fov, 1, 0.5, 400);
  skins: Skins[] = [];
  patterns = new Map<number, Pattern>();
  cellTri: Uint16Array;
  cellW: Float32Array;
  cellDir: Float32Array;
  cellSize: Float32Array;
  cellGlow: Float32Array;
  cellVel: Float32Array;
  cellLife: Float32Array;
  cellSpan: Float32Array;
  cellN: Int32Array; // how many of a place's cells are in use
  dA: Float32Array;
  dB: Float32Array;
  cellAttrs: InstancedBufferAttribute[];
  iA: Float32Array;
  iB: Float32Array;
  ballAttrs: InstancedBufferAttribute[];
  ballGeometry: InstancedBufferGeometry;
  wallPos = new Float32Array(8 * 3);
  wallAttr: BufferAttribute;
  lamps: Vector4[] = [];
  lampCount = uniform(0);
  materials: NodeMaterial[] = [];
  counts = { cells: 0, bodies: 0, flying: 0 };
  last = 0;
  rebased = 0;

  constructor(sim: Flow) {
    const add = (g: BufferGeometry, m: NodeMaterial, order: number) => {
      const mesh = new Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.materials.push(m);
      this.scene.add(mesh);
      return mesh;
    };
    const [, wy, wz] = sim.wall;
    const mirrors: Mirror[] = [
      { n: [0, wy, wz], side: 1 },
      { n: [0, wy, -wz], side: -1 },
    ];
    const views: Mirror[] = [...mirrors, null];

    // the walls: two strips from the fold outwards
    for (let i = 0; i < MOST; i++) this.lamps.push(new Vector4());
    const wg = new BufferGeometry();
    this.wallAttr = dynamic(wg, "position", this.wallPos, 3);
    wg.setAttribute("normal", new BufferAttribute(Float32Array.of(0, wy, wz, 0, wy, wz, 0, wy, wz, 0, wy, wz, 0, wy, -wz, 0, wy, -wz, 0, wy, -wz, 0, wy, -wz), 3));
    wg.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
    add(wg, wallMaterial(uniformArray(this.lamps, "vec4"), this.lampCount), 0);

    // the skins: every body of a pool in one mesh, on the simulation's own points
    let total = 0;
    sim.pools.forEach((pool, pi) => {
      const { mesh, cells, x } = pool;
      const count = cells.length,
        n = mesh.n;
      const g = new BufferGeometry();
      const nrm = new Float32Array(count * n * 3),
        aC = new Float32Array(count * n * 4),
        aD = new Float32Array(count * n * 4),
        aE = new Float32Array(count * n * 2);
      const idx = new Uint32Array(count * mesh.tris.length);
      for (let bi = 0; bi < count; bi++) {
        for (let t = 0; t < mesh.tris.length; t++) idx[bi * mesh.tris.length + t] = bi * n + mesh.tris[t];
        for (let i = 0; i < n; i++) aD.set([mesh.dirs[i * 3], mesh.dirs[i * 3 + 1], mesh.dirs[i * 3 + 2], 0], (bi * n + i) * 4);
      }
      const attrs = [dynamic(g, "position", x, 3), dynamic(g, "normal", nrm, 3), dynamic(g, "aC", aC, 4), dynamic(g, "aD", aD, 4), dynamic(g, "aE", aE, 2)];
      g.setIndex(new BufferAttribute(idx, 1));
      views.forEach((v, k) => add(g, jellyMaterial(v), v ? 2 + k : 8));
      const each = pi === 0 ? 3100 : 1100;
      this.skins.push({ mesh, cells, x, nrm, aC, aE, attrs, each, first: total, ids: new Int32Array(count).fill(-1) });
      total += each * count;
    });
    this.cellTri = new Uint16Array(total);
    this.cellW = new Float32Array(total * 2);
    this.cellDir = new Float32Array(total * 3);
    this.cellSize = new Float32Array(total);
    this.cellGlow = new Float32Array(total);
    this.cellVel = new Float32Array(total * 3);
    this.cellLife = new Float32Array(total);
    this.cellSpan = new Float32Array(total);
    this.cellN = new Int32Array(sim.pools[0].cells.length + sim.pools[1].cells.length);
    this.dA = new Float32Array(total * 4);
    this.dB = new Float32Array(total * 4);
    const quad = new BufferAttribute(Float32Array.of(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0), 3);
    const ig = new InstancedBufferGeometry();
    ig.setAttribute("position", quad);
    ig.setIndex([0, 1, 2, 0, 2, 3]);
    this.cellAttrs = [dynamic(ig, "dA", this.dA, 4, true) as InstancedBufferAttribute, dynamic(ig, "dB", this.dB, 4, true) as InstancedBufferAttribute];
    ig.instanceCount = total;
    views.forEach((v, k) => add(ig, cellMaterial(v, this.skins[1].first, this.skins[0].each, this.skins[1].each), v ? 4 + k : 9));

    // the daughters inside
    const most = this.cellN.length * K;
    this.iA = new Float32Array(most * 4);
    this.iB = new Float32Array(most * 4);
    const bg = new InstancedBufferGeometry();
    bg.setAttribute("position", quad);
    bg.setIndex([0, 1, 2, 0, 2, 3]);
    this.ballAttrs = [dynamic(bg, "iA", this.iA, 4, true) as InstancedBufferAttribute, dynamic(bg, "iB", this.iB, 4, true) as InstancedBufferAttribute];
    bg.instanceCount = 0;
    this.ballGeometry = bg;
    views.forEach((v, k) => add(bg, ballMaterial(v), v ? 1 : 7 + k * 0));
    this.counts.cells = total;
    this.rebased = sim.rebase.count;
  }

  dispose() {
    for (const m of this.materials) m.dispose();
    this.scene.traverse((o) => (o as Mesh).geometry?.dispose());
  }

  update(sim: Flow, aspect: number, pixelsHigh: number, seconds: number) {
    const dt = Math.min(0.05, Math.max(0, seconds - this.last));
    this.last = seconds;
    const { dA, dB, cellTri, cellW, cellDir, cellVel, cellLife, cellSpan } = this;
    // the world was made bigger: so is whatever of a burst colony is still in the air
    if (sim.rebase.count !== this.rebased) {
      this.rebased = sim.rebase.count;
      const { x: ox, by } = sim.rebase;
      for (let i = 0; i < cellLife.length; i++) {
        if (cellLife[i] <= 0) continue;
        dA[i * 4] = (dA[i * 4] - ox) * by;
        dA[i * 4 + 1] *= by;
        dA[i * 4 + 2] *= by;
        dA[i * 4 + 3] *= by;
        cellVel[i * 3] *= by;
        cellVel[i * 3 + 1] *= by;
        cellVel[i * 3 + 2] *= by;
      }
    }
    const torn = (b: Cell) => {
      const u = ((sim.step - b.burstAt) * H) / F.tear;
      return u >= 1 ? 4 : Math.PI * 1.04 * Math.pow(Math.max(0, u), 1.25);
    };
    const tan = Math.tan((F.steep * Math.PI) / 180);
    const cam = this.camera.position;
    const slow = Math.exp(-look.drag * dt),
      skid = Math.exp(-7 * dt);
    let flying = 0,
      bodies = 0,
      balls = 0;
    const { iA, iB } = this;
    const lamps: number[][] = [];
    let place = 0;
    for (const skin of this.skins) {
      const { mesh, cells, x: X, nrm: Nn, aC, aE } = skin;
      const n = mesh.n,
        dirs = mesh.dirs,
        tris = mesh.tris;
      normals(X, Nn, mesh, cells.length);
      cells.forEach((b, bi) => {
        const slot = place++;
        const from = skin.first + bi * skin.each;
        // nothing in this place: nothing of it drawn
        if (!b.alive) {
          if (skin.ids[bi] !== -1) {
            skin.ids[bi] = -1;
            for (let o = bi * n * 2, e = o + n * 2; o < e; o += 2) aE[o] = 0;
            for (let i = from; i < from + this.cellN[slot]; i++) {
              dA[i * 4 + 3] = dB[i * 4 + 3] = 0;
              cellLife[i] = -1;
            }
          }
          return;
        }
        bodies++;
        // a new body in this place: its kind's cells are laid out on it
        if (skin.ids[bi] !== b.id) {
          skin.ids[bi] = b.id;
          let pat = this.patterns.get(b.key);
          if (!pat) {
            const rel = b.R / b.sigma;
            pat = pattern(mesh, Math.min(skin.each, Math.round((skin.each === 3100 ? 2500 : 900) * rel * rel * (0.85 + 0.3 * b.seed))), 1000 + b.key);
            this.patterns.set(b.key, pat);
          }
          this.cellN[slot] = pat.count;
          cellTri.set(pat.tri, from);
          cellW.set(pat.w, from * 2);
          cellDir.set(pat.dir, from * 3);
          this.cellSize.set(pat.size, from);
          this.cellGlow.set(pat.glow, from);
          cellLife.fill(0, from, from + pat.count);
          for (let o = (bi * n + 0) * 4 + 3, i = 0; i < n; i++, o += 4) skin.attrs[3].array[o] = b.seed;
          skin.attrs[3].needsUpdate = true;
        }
        const cx = b.c[0],
          cy = b.c[1],
          cz = b.c[2];
        for (let o = bi * n * 4, e = o + n * 4; o < e; o += 4) {
          aC[o] = cx;
          aC[o + 1] = cy;
          aC[o + 2] = cz;
          aC[o + 3] = b.R;
        }
        const since = (sim.step - b.burstAt) * H;
        if (b.gone) {
          const front = torn(b);
          const flash = since > F.tear + 0.15 ? 0 : 1 + look.flash * Math.exp(-since / 0.07);
          const [fx, fy, fz] = b.burstFrom;
          for (let i = 0, o = bi * n * 2; i < n; i++, o += 2) {
            const angle = Math.acos(Math.min(1, Math.max(-1, dirs[i * 3] * fx + dirs[i * 3 + 1] * fy + dirs[i * 3 + 2] * fz)));
            aE[o] = smooth(front - 0.3, front + 0.04, angle) * flash;
            aE[o + 1] = b.grown;
          }
          if (since < 1) lamps.push([cx, cy, cz, 5 * b.R * b.R * Math.exp(-since / 0.12), 1e9]);
        } else {
          const lit = (b.prod ? 1 + (0.6 * b.prod.t) / F.fuse : 1) * b.there;
          for (let o = bi * n * 2, e = o + n * 2; o < e; o += 2) {
            aE[o] = lit;
            aE[o + 1] = b.grown;
          }
          lamps.push([cx, cy, cz, (0.5 + 0.6 * b.grown) * b.R * b.R * b.there, b.R]);
          // her daughters show as she grows clear
          const seen = smooth(0.15, 0.7, b.grown) * b.there;
          if (seen > 0) {
            for (let j = 0; j < K; j++, balls++) {
              iA[balls * 4] = b.inner[j * 9];
              iA[balls * 4 + 1] = b.inner[j * 9 + 1];
              iA[balls * 4 + 2] = b.inner[j * 9 + 2];
              iA[balls * 4 + 3] = RATIO * b.sigma * [1, 0.9, 1.08, 0.86, 0.96][j] * (0.55 + 0.45 * seen);
              iB[balls * 4] = (b.seed * 7 + j * 0.31) % 1;
              iB[balls * 4 + 1] = seen;
            }
          }
        }

        // The cells ride on the skin; where it has torn they are let go, thrown along it away from the
        // hole and a little outwards, slowed by the water, and sink to the wall and fade.
        const o = bi * n * 3;
        const shown = smooth(0.04, 0.55, b.grown) * b.there;
        const size = look.cellSize * b.sigma;
        const front = b.gone ? torn(b) : -1;
        const [fx, fy, fz] = b.burstFrom;
        const G = b.G,
          s = b.sigma;
        const mx = (b.c[0] - b.was[0]) / H,
          my = (b.c[1] - b.was[1]) / H,
          mz = (b.c[2] - b.was[2]) / H;
        const tcx = cam.x - cx,
          tcz = cam.z - cz;
        const tcl = Math.hypot(tcx, tcz) || 1;
        for (let i = from, e = from + this.cellN[slot]; i < e; i++) {
          const k = i * 4;
          let life = cellLife[i];
          if (life < 0) continue;
          if (life === 0) {
            const t = cellTri[i] * 3;
            const A = o + tris[t] * 3,
              B = o + tris[t + 1] * 3,
              C = o + tris[t + 2] * 3;
            const u = cellW[i * 2],
              v = cellW[i * 2 + 1],
              w = 1 - u - v;
            dA[k] = w * X[A] + u * X[B] + v * X[C];
            dA[k + 1] = w * X[A + 1] + u * X[B + 1] + v * X[C + 1];
            dA[k + 2] = w * X[A + 2] + u * X[B + 2] + v * X[C + 2];
            dA[k + 3] = size * this.cellSize[i];
            dB[k] = w * Nn[A] + u * Nn[B] + v * Nn[C];
            dB[k + 1] = w * Nn[A + 1] + u * Nn[B + 1] + v * Nn[C + 1];
            dB[k + 2] = w * Nn[A + 2] + u * Nn[B + 2] + v * Nn[C + 2];
            dB[k + 3] = this.cellGlow[i] * shown;
            if (front < 0) continue;
            const dx = cellDir[i * 3],
              dy = cellDir[i * 3 + 1],
              dz = cellDir[i * 3 + 2];
            const facing = dx * fx + dy * fy + dz * fz;
            if (Math.acos(Math.min(1, Math.max(-1, facing))) > front) continue;
            const ax = dx * facing - fx,
              ay = dy * facing - fy,
              az = dz * facing - fz;
            let wx = G[0] * ax + G[1] * ay + G[2] * az,
              wy = G[3] * ax + G[4] * ay + G[5] * az,
              wz = G[6] * ax + G[7] * ay + G[8] * az;
            const wl = Math.hypot(wx, wy, wz) || 1;
            const along = (look.fling * s * (0.35 + 0.9 * chance(i - from, 1))) / wl,
              out = look.puff * s * (0.2 + 1.6 * chance(i - from, 2) * chance(i - from, 5));
            wx = wx * along + dB[k] * out + (chance(i - from, 3) - 0.5) * 1.2 * s;
            wy = wy * along + dB[k + 1] * out + (chance(i - from, 4) - 0.5) * 1.2 * s;
            wz = wz * along + dB[k + 2] * out + (chance(i - from, 6) - 0.5) * 1.2 * s;
            cellVel[i * 3] = mx + wx;
            cellVel[i * 3 + 1] = my + wy;
            cellVel[i * 3 + 2] = mz + wz;
            cellSpan[i] = look.linger * (0.35 + 0.65 * chance(i - from, 7));
            life = cellLife[i] = cellSpan[i];
          }
          flying++;
          let vx = cellVel[i * 3] * slow,
            vy = cellVel[i * 3 + 1] * slow - look.fall * s * dt,
            vz = cellVel[i * 3 + 2] * slow;
          dA[k] += vx * dt;
          dA[k + 1] += vy * dt;
          dA[k + 2] += vz * dt;
          const ground = Math.abs(dA[k + 2]) * tan + 0.006 * s;
          if (dA[k + 1] < ground) {
            dA[k + 1] = ground;
            vy = 0;
            vx *= skid;
            vz *= skid;
          }
          cellVel[i * 3] = vx;
          cellVel[i * 3 + 1] = vy;
          cellVel[i * 3 + 2] = vz;
          life -= dt;
          const span = cellSpan[i],
            past = span - life;
          if (life <= 0) {
            cellLife[i] = -1;
            dA[k + 3] = 0;
            dB[k + 3] = 0;
            continue;
          }
          cellLife[i] = life;
          dB[k] = tcx / tcl;
          dB[k + 1] = 0;
          dB[k + 2] = tcz / tcl;
          dB[k + 3] = this.cellGlow[i] * (1 + 1.8 * Math.exp(-past / 0.22)) * smooth(0, 0.45, life / span) * (0.75 + 0.25 * Math.sin(past * (9 + 9 * chance(i - from, 8)) + (i - from)));
        }
      });
      for (const a of skin.attrs) if (a !== skin.attrs[3]) a.needsUpdate = true;
    }
    for (const a of this.cellAttrs) a.needsUpdate = true;
    for (const a of this.ballAttrs) a.needsUpdate = true;
    this.ballGeometry.instanceCount = balls;
    this.counts.flying = flying;
    this.counts.bodies = bodies;

    // light on the walls: the biggest things first
    lamps.sort((a, b) => b[4] - a[4]);
    this.lampCount.value = Math.min(MOST, lamps.length);
    lamps.slice(0, MOST).forEach((l, i) => this.lamps[i].set(l[0], l[1], l[2], l[3]));

    // The camera has no memory: where it is comes from the bodies alone, so it repeats when they do.
    const v = sim.view;
    const yaw = (look.yaw * Math.PI) / 180,
      pitch = (look.pitch * Math.PI) / 180;
    const d = look.distance * v.scale * Math.max(1, 1.25 / aspect);
    const tx = v.x + look.ahead * v.scale,
      ty = v.y + look.rise * v.scale,
      tz = v.z;
    this.camera.position.set(tx + Math.sin(yaw) * Math.cos(pitch) * d, ty + Math.sin(pitch) * d, tz + Math.cos(yaw) * Math.cos(pitch) * d);
    // "up" is against the weight, so the channel is seen running downhill
    this.camera.up.set(-sim.down[0], -sim.down[1], 0);
    this.camera.fov = look.fov;
    this.camera.aspect = aspect;
    this.camera.near = d * 0.02;
    this.camera.far = d * 60;
    this.camera.lookAt(tx, ty, tz);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    // the walls, as far as can be seen, from the fold out
    const far = d * 30;
    const wy = sim.wall[1],
      wz = sim.wall[2];
    // a point `far` up a wall from the fold: along the wall, square to the channel
    const up = [-wz * far, wy * far];
    this.wallPos.set([tx - far, 0, 0, tx + far, 0, 0, tx + far, up[0], up[1], tx - far, up[0], up[1], tx - far, 0, 0, tx + far, 0, 0, tx + far, up[0], -up[1], tx - far, up[0], -up[1]]);
    this.wallAttr.needsUpdate = true;

    U.focus.value = d + look.focusAt * v.scale;
    U.scale.value = v.scale;
    U.aperture.value = look.aperture * 0.05;
    U.pixel.value = (2 * Math.tan((look.fov * Math.PI) / 360)) / pixelsHigh;
    U.cells.value = look.cells;
    U.cellHalo.value = look.cellHalo;
    U.tooth.value = look.tooth;
    U.farSide.value = look.farSide;
    U.bokeh.value = look.bokeh;
    U.jelly.value = look.jelly;
    U.coat.value = look.coat;
    U.daughters.value = look.daughters;
    U.stipple.value = look.stipple;
    U.key.value = look.key;
    U.mirror.value = look.mirror;
    U.rough.value = look.rough;
    U.deep.value = look.deep;
    U.pool.value = look.pool;
  }
}
