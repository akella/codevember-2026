// Drawing the colonies as a dark-field photograph of them would look: everything is light added to
// black. A colony is three things: its cells, one small square each on the skin; the jelly of the
// skin, a glow that is brightest at the rim; and its daughters, bright balls inside.
//
// The lens is in every one of them rather than in a pass afterwards. A cell's square grows by how far
// out of focus that cell is; the rim of a ball is at the depth of its middle, so the glow of a ball is
// softened by one amount for the whole ball. The floor is a mirror: everything is drawn a second time
// upside down under it, softer the higher above the floor it is.
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
import { type Ball, type Body, H, rng, type Sim, smooth, V } from "./soft.ts";

export const look = {
  // the camera
  fov: 24,
  pitch: 26, // degrees above the floor
  distance: 16,
  sway: 0.32, // how far round it drifts, radians each way
  swayEvery: 46, // seconds
  follow: 0.7, // how far it turns towards the colony in focus
  aperture: 0.7, // how fast things soften away from the focus
  pull: 1, // focus goes to one colony
  rack: 7, // and on to another of the nearest few after this many seconds
  focusAt: -0.25, // on its near face (-1), its rim (0) or its far face (1)
  // the colonies
  cells: 1,
  cellSize: 0.0105,
  cellHalo: 0.5,
  tooth: 0.55, // cells seen side on, at the rim, are longer than wide
  farSide: 0.8, // cells on the far half of a colony
  bokeh: 0.5, // a brighter edge to a cell far out of focus
  jelly: 1,
  coat: 0.05, // the jelly reaches this far out past the cells, in radii
  daughters: 1,
  stipple: 0.5, // the grain of a daughter in focus
  key: 0.35, // one side lit a little more
  // a colony bursting
  flash: 2.5, // its skin lights up as it gives
  fling: 4.2, // its cells are thrown along the skin, away from where it tore, this fast
  puff: 1.5, // and outwards
  drag: 3.2, // the water stops them
  fall: 2.0, // and they sink
  linger: 5, // seconds before the last of them has faded
  // the floor
  mirror: 0.3, // looking straight down; it is a whole mirror at a glancing angle
  rough: 0.14, // a reflection softens by this much of the height above the floor
  deep: 0.12, // and dims with it: the floor is not a perfect mirror
  pool: 0.5, // light spilled on the floor under a colony
  specks: 1, // dust on it
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;
const {
  abs,
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  dot,
  exp,
  float,
  Fn,
  length,
  Loop,
  mix,
  mx_noise_float,
  mx_worley_noise_float,
  normalize,
  positionGeometry,
  smoothstep,
  sqrt,
  uniform,
  uniformArray,
  varying,
  vec2,
  vec3,
  vec4,
}: Record<string, Node> = TSL;

const U = {
  focus: uniform(19),
  aperture: uniform(look.aperture),
  pixel: uniform(0.001), // one pixel, as an angle
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
};
const KEY = new Vector3(-0.5, 0.62, 0.6).normalize();
const MOST = 16; // colonies that light the floor

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

// How soft a point at this depth is drawn: the radius, in the world, of the disc a point of light
// there is spread into. It grows in step with the distance from the plane in focus, and by the same
// amount however near the camera is, as it does close up through a microscope.
const circle = (depth: Node) => U.aperture.mul(depth.sub(U.focus).abs());
// How much of the light a point under the floor is the reflection of comes back: little looking
// straight down, all of it at a glancing angle.
const shine = (at: Node) => {
  const down = normalize(at.sub(cameraPosition)).y.abs();
  return mix(float(1), float(1).sub(down).pow(5), float(1).sub(U.mirror)).mul(exp(at.y.abs().mul(U.deep).negate()));
};

// The cells of the skin, and the dust on the floor.
function cellMaterial(mirror: boolean) {
  const m = glowing();
  const dA: Node = attribute("dA", "vec4"); // where, radius
  const dB: Node = attribute("dB", "vec4"); // which way the skin faces there, brightness
  const corner: Node = positionGeometry.xy;
  const flip = vec3(1, mirror ? -1 : 1, 1);
  const centre = dA.xyz.mul(flip);
  const facing = dB.xyz.mul(flip);
  const cv = cameraViewMatrix.mul(vec4(centre, 1)).xyz;
  const nv = cameraViewMatrix.mul(vec4(facing, 0)).xyz;
  const depth = cv.z.negate().max(0.05);
  let soft2: Node = circle(depth).pow2().add(depth.mul(U.pixel).mul(0.55).pow2());
  if (mirror) soft2 = soft2.add(dA.y.mul(U.rough).pow2());
  // Side on a cell is a short stroke along the way the skin faces: the comb of teeth at the rim.
  const sideways = length(nv.xy);
  const axis = nv.xy.div(sideways.max(1e-4));
  const r0: Node = dA.w;
  const ra = r0.mul(U.tooth.mul(smoothstep(0.55, 1, sideways)).add(1));
  const ea = sqrt(ra.pow2().add(soft2)),
    eb = sqrt(r0.pow2().add(soft2));
  const sharpness = r0.div(eb); // 1 in focus, towards 0 far out of it
  const REACH = mix(float(1.2), float(2.6), sharpness); // the square reaches this many radii: in focus, for the halo
  const off = axis.mul(corner.x).mul(ea).add(vec2(axis.y.negate(), axis.x).mul(corner.y).mul(eb)).mul(REACH);
  m.vertexNode = cameraProjectionMatrix.mul(vec4(cv.add(vec3(off, 0)), 1));
  const q: Node = varying(corner.mul(REACH));
  // the same light over a bigger disc is dimmer
  const lit = dot(facing, vec3(KEY.x, KEY.y, KEY.z))
    .mul(U.key)
    .add(1);
  const back = mix(U.farSide, float(1), smoothstep(-0.25, 0.25, nv.z));
  let gain: Node = r0.pow2().div(ea.mul(eb)).mul(dB.w).mul(lit).mul(back).mul(U.cells);
  if (mirror) gain = gain.mul(shine(centre));
  const power: Node = varying(gain);
  const sharp: Node = varying(sharpness);
  m.fragmentNode = Fn(() => {
    const t = length(q);
    // in focus a bead with a soft edge; out of focus a flat disc with a crisp, slightly brighter one
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

// A ball of jelly: hollow (the skin of a colony) or nearly full (a daughter). What is seen of it at a
// point is how much jelly the line of sight passes through there, which depends only on how far from
// the middle the line passes: that is read off the angle of the surface to the eye.
function jellyMaterial(mirror: boolean, daughter: boolean) {
  const m = glowing();
  m.side = mirror ? BackSide : FrontSide;
  const aC: Node = attribute("aC", "vec4"); // middle, radius
  const aD: Node = attribute("aD", "vec4"); // place on the unit ball, seed
  const aE: Node = attribute("aE", "vec2"); // how much of it is there; how far from daughter (0) to colony (1)
  const nrm: Node = attribute("normal", "vec3");
  const grown: Node = daughter ? aE.y : float(1);
  const flip = vec3(1, mirror ? -1 : 1, 1);
  const cv = cameraViewMatrix.mul(vec4(aC.xyz.mul(flip), 1)).xyz;
  const depth = cv.z.negate().max(0.05);
  let soft2: Node = circle(depth).pow2().add(depth.mul(U.pixel).pow2());
  // under the floor it is sharp where it touches and soft at the top
  if (mirror) soft2 = soft2.add(positionGeometry.y.mul(U.rough).pow2());
  const blur = sqrt(soft2).div(aC.w).min(3); // in its own radii
  // drawn this much bigger, so the soft edge has somewhere to be; and a colony's jelly is a coat over its cells
  const coat = U.coat.mul(grown);
  const swell = blur.mul(1.5);
  const at = positionGeometry.add(nrm.mul(swell.add(coat)).mul(aC.w)).mul(flip);
  m.positionNode = at;
  const wn: Node = varying(nrm.mul(flip)),
    wp: Node = varying(at),
    vBlur: Node = varying(blur),
    vSwell: Node = varying(swell),
    place: Node = varying(aD.xyz),
    seed: Node = varying(aD.w),
    there: Node = varying(aE.x),
    age: Node = varying(grown);
  // a daughter is nearly a full ball with a thick skin; a colony a thin skin round a faint haze
  const between = (young: number, old: number): Node => (daughter ? mix(float(young), float(old), age) : float(old));
  const inner = between(0.84, 0.925); // where the skin ends, in radii
  const hollow = between(0.42, 1); // how empty it is inside that
  const fill = between(0, 0.03); // haze through the middle
  m.fragmentNode = Fn(() => {
    const eye = normalize(wp.sub(cameraPosition));
    const n = normalize(wn);
    const mu = dot(n, eye).abs();
    const rho = sqrt(float(1).sub(mu.mul(mu)).max(0)).mul(vSwell.add(1));
    // The amount of jelly along the line, taken at several distances either side: the lens's blur.
    // A thin skin sampled a few times would show as that many rings, so as the blur grows the skin is
    // taken to be thicker and fainter by as much, which comes to the same light.
    const thick = float(1).sub(inner);
    const wide = thick.add(vBlur.mul(0.6)).min(0.98);
    const core2 = float(1).sub(wide).pow2();
    const faint = thick.div(wide).mul(hollow);
    const full = float(1).sub(hollow).add(fill);
    let sum: Node = float(0);
    const TAPS = 13;
    let all = 0;
    for (let k = 0; k < TAPS; k++) all += Math.exp(-2 * ((k / (TAPS - 1)) * 2 - 1) ** 2);
    for (let k = 0; k < TAPS; k++) {
      const o = ((k / (TAPS - 1)) * 2 - 1) * 1.5;
      const w = Math.exp(-2 * (o / 1.5) ** 2) / all;
      const r = rho.add(vBlur.mul(o)).abs();
      const r2 = r.mul(r);
      const outer = sqrt(float(1).sub(r2).max(0));
      const core = sqrt(core2.sub(r2).max(0));
      // a full ball's share, and a skin's
      sum = sum.add(outer.mul(full).add(outer.sub(core).mul(faint)).mul(w));
    }
    const lit = dot(n, vec3(KEY.x, KEY.y, KEY.z))
      .mul(U.key)
      .add(1);
    // a colony: greener at the rim, where the skin is seen edge on; bluer through the thin middle
    const skinTone = mix(vec3(0.01, 0.4, 0.12), vec3(0.05, 0.8, 0.06), smoothstep(0.1, 0.4, sum));
    let rgb: Node = skinTone.mul(sum).mul(U.jelly).mul(0.45);
    if (daughter) {
      // a daughter in focus has a grain: it is a ball of cells itself, too close together to tell apart
      const near = float(1).sub(smoothstep(0.03, 0.22, vBlur));
      const cellsHere = mx_worley_noise_float(place.mul(11).add(seed.mul(31)));
      const grain = mix(float(1), smoothstep(0.05, 0.5, cellsHere).mul(0.7).add(0.55), near.mul(U.stipple));
      const tone = mix(vec3(0.22, 0.95, 0.04), vec3(0.42, 1.0, 0.05), seed);
      rgb = mix(tone.mul(sum).mul(grain).mul(U.daughters).mul(1.5), rgb, age);
    }
    rgb = rgb.mul(lit).mul(there);
    if (mirror) rgb = rgb.mul(shine(wp));
    return vec4(rgb, 1);
  })();
  return m;
}

// The floor is black. All it shows of its own is the little light that spills on it under each colony
// (a ball of light at a height lights the ground in a pool), through a fine grain.
function floorMaterial(pools: Node, count: Node) {
  const m = glowing();
  const at: Node = varying(positionGeometry.xz);
  m.fragmentNode = Fn(() => {
    const sum = float(0).toVar();
    Loop(MOST, ({ i }: { i: Node }) => {
      const p = pools.element(i);
      const d = at.sub(p.xy);
      const h = p.z;
      sum.addAssign(
        p.w
          .mul(h)
          .mul(h)
          .mul(h)
          .div(dot(d, d).add(h.mul(h)).pow(1.5))
          .mul(float(i).lessThan(count).select(1, 0)),
      );
    });
    const grain = mx_noise_float(vec3(at.mul(9), 0.5))
      .mul(0.35)
      .add(mx_noise_float(vec3(at.mul(47), 2.5)).mul(0.25))
      .add(0.8);
    return vec4(vec3(0.002, 0.03, 0.005).mul(sum).mul(grain).mul(U.pool), 1);
  })();
  return m;
}

function dynamic(g: BufferGeometry, name: string, array: Float32Array, size: number, instanced = false) {
  const a = instanced ? new InstancedBufferAttribute(array, size) : new BufferAttribute(array, size);
  a.setUsage(DynamicDrawUsage);
  g.setAttribute(name, a);
  return a;
}

// Normals of many balls kept in one array, all with the same triangles.
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

// One mesh of many balls: the points are the simulation's own array.
function balls(x: Float32Array, mesh: Ball, bodies: Body[]) {
  const count = bodies.length,
    n = mesh.n;
  const g = new BufferGeometry();
  const nrm = new Float32Array(Math.max(1, count) * n * 3),
    aC = new Float32Array(Math.max(1, count) * n * 4),
    aD = new Float32Array(Math.max(1, count) * n * 4),
    aE = new Float32Array(Math.max(1, count) * n * 2);
  const idx = new Uint32Array(count * mesh.tris.length);
  bodies.forEach((b, bi) => {
    for (let t = 0; t < mesh.tris.length; t++) idx[bi * mesh.tris.length + t] = bi * n + mesh.tris[t];
    for (let i = 0; i < n; i++) {
      const o = (bi * n + i) * 4;
      aD[o] = mesh.dirs[i * 3];
      aD[o + 1] = mesh.dirs[i * 3 + 1];
      aD[o + 2] = mesh.dirs[i * 3 + 2];
      aD[o + 3] = b.seed;
    }
  });
  const attrs = [dynamic(g, "position", x, 3), dynamic(g, "normal", nrm, 3), dynamic(g, "aC", aC, 4), dynamic(g, "aE", aE, 2)];
  g.setAttribute("aD", new BufferAttribute(aD, 4));
  g.setIndex(new BufferAttribute(idx, 1));
  return { g, nrm, aC, aE, attrs, mesh, bodies };
}

// The cells of one body: a run of the big list, pinned to that body's skin.
interface Group {
  body: Body;
  start: number;
  count: number;
  mesh: Ball;
  x: Float32Array; // the points of every body of its kind
  nrm: Float32Array;
  at: number; // where this body's points start in those
}

// a number from 0 to 1 for a cell, the same every time
const chance = (i: number, k: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

export class Painter {
  scene = new Scene();
  camera = new PerspectiveCamera(look.fov, 1, 0.5, 400);
  target = new Vector3(0, 0.7, 0);
  focus = 0;
  tops: ReturnType<typeof balls>;
  kids: ReturnType<typeof balls>;
  groups: Group[] = [];
  // a cell: which triangle of its body's skin it sits on and where in it, and where on the unit ball
  cellTri: Uint16Array;
  cellW: Float32Array;
  cellDir: Float32Array;
  cellSize: Float32Array;
  cellGlow: Float32Array;
  // and once its colony has burst: how it is flying, how long it has left (0 while still on the skin)
  cellVel: Float32Array;
  cellLife: Float32Array;
  cellSpan: Float32Array;
  dA: Float32Array;
  dB: Float32Array;
  cellCount = 0;
  speckCount = 420;
  cellAttrs: InstancedBufferAttribute[];
  materials: NodeMaterial[] = [];
  pools: Vector4[] = [];
  poolCount = uniform(0);
  counts = { cells: 0, colonies: 0, daughters: 0, flying: 0 };
  last = 0; // the time of the last picture

  constructor(sim: Sim) {
    const add = (g: BufferGeometry, m: NodeMaterial, order: number) => {
      const mesh = new Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.materials.push(m);
      this.scene.add(mesh);
      return mesh;
    };

    // the floor
    for (let i = 0; i < MOST; i++) this.pools.push(new Vector4());
    const fg = new BufferGeometry();
    const far = 120;
    fg.setAttribute("position", new BufferAttribute(Float32Array.of(-far, 0, -far, far, 0, -far, far, 0, far, -far, 0, far), 3));
    fg.setIndex([0, 2, 1, 0, 3, 2]);
    add(fg, floorMaterial(uniformArray(this.pools, "vec4"), this.poolCount), 0);

    this.tops = balls(sim.topX, sim.big, sim.tops);
    this.kids = balls(sim.kidX, sim.small, sim.kids);
    add(this.kids.g, jellyMaterial(true, true), 1);
    add(this.tops.g, jellyMaterial(true, false), 2);
    add(this.kids.g, jellyMaterial(false, true), 5);
    add(this.tops.g, jellyMaterial(false, false), 6);
    if (!sim.kids.length) this.kids.g.setDrawRange(0, 0);

    // The cells: evenly over each sphere (a golden spiral, each nudged off it so no spiral shows),
    // each pinned to the triangle of the skin under it. A daughter has hers from the start, for the
    // size she will grow to; they are not drawn until she is out and they have drawn apart.
    const rand = rng(V.seed * 7 + 1);
    let total = 0;
    for (const set of [this.tops, this.kids]) {
      set.bodies.forEach((b, bi) => {
        const R = set === this.kids ? b.R0 * V.grow : b.R;
        const count = Math.round(V.dots * R * R * (0.75 + 0.5 * b.seed));
        this.groups.push({ body: b, start: total, count, mesh: set.mesh, x: set.g.getAttribute("position").array as Float32Array, nrm: set.nrm, at: bi * set.mesh.n * 3 });
        total += count;
      });
    }
    this.cellCount = total;
    const all = total + this.speckCount;
    this.cellTri = new Uint16Array(total);
    this.cellW = new Float32Array(total * 2);
    this.cellDir = new Float32Array(total * 3);
    this.cellSize = new Float32Array(total);
    this.cellGlow = new Float32Array(total);
    this.cellVel = new Float32Array(total * 3);
    this.cellLife = new Float32Array(total);
    this.cellSpan = new Float32Array(total);
    this.dA = new Float32Array(all * 4);
    this.dB = new Float32Array(all * 4);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const middles = new Map<Ball, Float32Array>();
    for (const { start, count, mesh } of this.groups) {
      const { dirs, tris } = mesh;
      const nt = tris.length / 3;
      let mids = middles.get(mesh);
      if (!mids) {
        mids = new Float32Array(nt * 3);
        for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) mids[t * 3 + k] = (dirs[tris[t * 3] * 3 + k] + dirs[tris[t * 3 + 1] * 3 + k] + dirs[tris[t * 3 + 2] * 3 + k]) / 3;
        middles.set(mesh, mids);
      }
      const gap = Math.sqrt((4 * Math.PI) / count); // between neighbours, on the unit ball
      for (let i = 0, ci = start; i < count; i++, ci++) {
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
        // where the line from the middle through the cell crosses that triangle, as weights of its corners
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
        const u = (tx * px + ty * py + tz * pz) / det;
        const qx = ty * e1z - tz * e1y,
          qy = tz * e1x - tx * e1z,
          qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dy * qy + dz * qz) / det;
        this.cellTri[ci] = best;
        this.cellW[ci * 2] = u;
        this.cellW[ci * 2 + 1] = v;
        this.cellDir[ci * 3] = dx;
        this.cellDir[ci * 3 + 1] = dy;
        this.cellDir[ci * 3 + 2] = dz;
        this.cellSize[ci] = 0.8 + rand() * 0.45;
        this.cellGlow[ci] = 0.65 + rand() * 0.7;
      }
    }
    // dust on the floor, thicker towards the middle
    for (let i = 0; i < this.speckCount; i++) {
      const o = (total + i) * 4;
      const a = rand() * Math.PI * 2,
        d = Math.pow(rand(), 0.7) * sim.bowl * 2.4;
      this.dA[o] = Math.cos(a) * d;
      this.dA[o + 1] = 0.004;
      this.dA[o + 2] = Math.sin(a) * d;
      this.dA[o + 3] = 0.005 + rand() * rand() * 0.016;
      this.dB[o + 1] = 1;
      this.dB[o + 3] = 0.25 + rand();
    }
    const ig = new InstancedBufferGeometry();
    ig.setAttribute("position", new BufferAttribute(Float32Array.of(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0), 3));
    ig.setIndex([0, 1, 2, 0, 2, 3]);
    this.cellAttrs = [dynamic(ig, "dA", this.dA, 4, true) as InstancedBufferAttribute, dynamic(ig, "dB", this.dB, 4, true) as InstancedBufferAttribute];
    ig.instanceCount = all;
    add(ig, cellMaterial(false), 7);
    // the reflection has the colonies' cells but not the dust: a second geometry on the same arrays
    const mg = new InstancedBufferGeometry();
    mg.setAttribute("position", ig.getAttribute("position"));
    mg.setIndex(ig.getIndex());
    mg.setAttribute("dA", this.cellAttrs[0]);
    mg.setAttribute("dB", this.cellAttrs[1]);
    mg.instanceCount = total;
    add(mg, cellMaterial(true), 3);
    this.counts = { cells: total, colonies: sim.tops.length, daughters: sim.kids.length, flying: 0 };
  }

  dispose() {
    for (const m of this.materials) m.dispose();
    this.scene.traverse((o) => (o as Mesh).geometry?.dispose());
  }

  update(sim: Sim, aspect: number, pixelsHigh: number, seconds: number) {
    const { tops, kids } = this;
    const dt = Math.min(0.05, Math.max(0, seconds - this.last));
    this.last = seconds;
    // A skin that has given tears open from where it was poked, the hole running round to the far
    // side at a steady pace, as a soap bubble's does.
    const torn = (b: Body) => {
      const u = ((sim.step - b.burstAt) * H) / V.tear;
      return u >= 1 ? 4 : Math.PI * 1.04 * Math.pow(Math.max(0, u), 1.25);
    };

    // the balls
    normals(sim.topX, tops.nrm, sim.big, sim.tops.length);
    normals(sim.kidX, kids.nrm, sim.small, sim.kids.length);
    for (const set of [tops, kids]) {
      const n = set.mesh.n,
        dirs = set.mesh.dirs;
      set.bodies.forEach((b, bi) => {
        const cx = b.c[0],
          cy = b.c[1],
          cz = b.c[2];
        for (let o = bi * n * 4, e = o + n * 4; o < e; o += 4) {
          set.aC[o] = cx;
          set.aC[o + 1] = cy;
          set.aC[o + 2] = cz;
          set.aC[o + 3] = b.R;
        }
        const E = set.aE;
        if (b.gone) {
          const front = torn(b);
          const flash = 1 + look.flash * Math.exp(-((sim.step - b.burstAt) * H) / 0.07);
          const [fx, fy, fz] = b.burstFrom;
          for (let i = 0, o = bi * n * 2; i < n; i++, o += 2) {
            const angle = Math.acos(Math.min(1, Math.max(-1, dirs[i * 3] * fx + dirs[i * 3 + 1] * fy + dirs[i * 3 + 2] * fz)));
            E[o] = smooth(front - 0.3, front + 0.04, angle) * flash;
            E[o + 1] = b.grown;
          }
        } else {
          // a poke lights the skin a little where it is pressed
          const lit = b.prod ? 1 + (0.6 * b.prod.t) / V.fuse : 1;
          for (let o = bi * n * 2, e = o + n * 2; o < e; o += 2) {
            E[o] = lit;
            E[o + 1] = b.grown;
          }
        }
      });
      for (const a of set.attrs) a.needsUpdate = true;
    }

    // The cells ride on the skin; where the skin has torn they are let go, thrown along it away from
    // the hole and a little outwards, and the water slows them until they sink to the floor and fade.
    const { dA, dB, cellTri, cellW, cellDir, cellVel, cellLife, cellSpan } = this;
    const size = look.cellSize;
    const cam = this.camera.position;
    let flying = 0;
    const slow = Math.exp(-look.drag * dt),
      skid = Math.exp(-7 * dt);
    for (const g of this.groups) {
      const b = g.body;
      if (b.parent) continue; // still inside its mother: not drawn (nothing has ever been written for it)
      const { x: X, nrm: Nn, at: o } = g;
      const tris = g.mesh.tris;
      const shown = b.freedAt < 0 ? 1 : smooth(0.04, 0.55, b.grown);
      const front = b.gone ? torn(b) : -1;
      const [fx, fy, fz] = b.burstFrom;
      const G = b.G;
      // the way the colony was going when it burst
      const mx = (b.c[0] - b.was[0]) / H,
        my = (b.c[1] - b.was[1]) / H,
        mz = (b.c[2] - b.was[2]) / H;
      // flying cells face the camera, level: round, with no long axis
      const tcx = cam.x - b.c[0],
        tcz = cam.z - b.c[2];
      const tcl = Math.hypot(tcx, tcz) || 1;
      for (let i = g.start, e = g.start + g.count; i < e; i++) {
        const k = i * 4;
        let life = cellLife[i];
        if (life < 0) continue; // faded out
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
          // let go: along the skin away from the hole (in the colony's own frame, then as it lies), and out
          let ax = dx * facing - fx,
            ay = dy * facing - fy,
            az = dz * facing - fz;
          let wx = G[0] * ax + G[1] * ay + G[2] * az,
            wy = G[3] * ax + G[4] * ay + G[5] * az,
            wz = G[6] * ax + G[7] * ay + G[8] * az;
          const wl = Math.hypot(wx, wy, wz) || 1;
          const along = (look.fling * (0.35 + 0.9 * chance(i, 1))) / wl,
            out = look.puff * (0.2 + 1.6 * chance(i, 2) * chance(i, 5));
          wx = wx * along + dB[k] * out + (chance(i, 3) - 0.5) * 1.2;
          wy = wy * along + dB[k + 1] * out + (chance(i, 4) - 0.5) * 1.2;
          wz = wz * along + dB[k + 2] * out + (chance(i, 6) - 0.5) * 1.2;
          ax = ay = az = 0;
          cellVel[i * 3] = mx + wx;
          cellVel[i * 3 + 1] = my + wy;
          cellVel[i * 3 + 2] = mz + wz;
          cellSpan[i] = look.linger * (0.35 + 0.65 * chance(i, 7));
          life = cellLife[i] = cellSpan[i];
        }
        flying++;
        let vx = cellVel[i * 3] * slow,
          vy = cellVel[i * 3 + 1] * slow - look.fall * dt,
          vz = cellVel[i * 3 + 2] * slow;
        dA[k] += vx * dt;
        dA[k + 1] += vy * dt;
        dA[k + 2] += vz * dt;
        if (dA[k + 1] < 0.006) {
          dA[k + 1] = 0.006;
          vy = 0;
          vx *= skid;
          vz *= skid;
        }
        cellVel[i * 3] = vx;
        cellVel[i * 3 + 1] = vy;
        cellVel[i * 3 + 2] = vz;
        life -= dt;
        const span = cellSpan[i],
          since = span - life;
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
        // bright as it is let go, then its own light, twinkling, then gone
        dB[k + 3] = this.cellGlow[i] * (1 + 1.8 * Math.exp(-since / 0.22)) * smooth(0, 0.45, life / span) * (0.75 + 0.25 * Math.sin(since * (9 + 9 * chance(i, 8)) + i));
      }
    }
    this.counts.flying = flying;
    // dust shows where a colony's light falls on it
    for (let i = 0; i < this.speckCount; i++) {
      const k = (this.cellCount + i) * 4;
      let lit = 0.04;
      for (const b of sim.free) {
        const dx = dA[k] - b.c[0],
          dz = dA[k + 2] - b.c[2];
        lit += (b.R * b.R) / (dx * dx + dz * dz + b.R * b.R);
      }
      dB[k] = 0;
      dB[k + 1] = 1;
      dB[k + 2] = 0;
      dB[k + 3] = Math.min(1.2, lit) * 0.55 * look.specks * (0.3 + ((i * 7919) % 100) / 100);
    }
    for (const a of this.cellAttrs) a.needsUpdate = true;

    // light on the floor: under the biggest of them, and a flash where one has just burst
    const lamps: number[][] = sim.ghosts.map((b) => [b.c[0], b.c[2], Math.max(0.3, b.c[1]), 5 * Math.exp(-((sim.step - b.burstAt) * H) / 0.12)]);
    for (const b of [...sim.free].sort((a, b) => b.R - a.R)) lamps.push([b.c[0], b.c[2], Math.max(0.3, b.c[1]), (0.5 + 0.12 * b.kids.length) * smooth(9, 2.5, b.c[1] / b.R)]);
    this.poolCount.value = Math.min(MOST, lamps.length);
    lamps.slice(0, MOST).forEach((l, i) => this.pools[i].set(l[0], l[1], l[2], l[3]));

    // The camera drifts round a little, looks at the middle of them all leaning towards the one in
    // focus, and keeps that one sharp.
    let mx = 0,
      mz = 0,
      weight = 0;
    for (const b of sim.free) {
      const w = b.R * b.R * b.R;
      mx += b.c[0] * w;
      mz += b.c[2] * w;
      weight += w;
    }
    mx /= weight || 1;
    mz /= weight || 1;
    const sub = this.subject(sim, seconds);
    const landed = sub ? smooth(6, 1.2, sub.c[1] / Math.max(1, sub.R)) : 0;
    const tx = mx + (sub ? (sub.c[0] - mx) * look.follow * landed : 0),
      tz = mz + (sub ? (sub.c[2] - mz) * look.follow * landed : 0);
    const ease = this.focus ? 0.02 : 1;
    this.target.x += (tx - this.target.x) * ease;
    this.target.z += (tz - this.target.z) * ease;
    const around = Math.sin((seconds / look.swayEvery) * Math.PI * 2) * look.sway + 0.25;
    const pitch = (look.pitch * Math.PI) / 180;
    // a tall window sees less across: step back
    const d = look.distance * Math.max(1, 1.25 / aspect);
    this.camera.position.set(this.target.x + Math.sin(around) * Math.cos(pitch) * d, this.target.y + Math.sin(pitch) * d, this.target.z + Math.cos(around) * Math.cos(pitch) * d);
    this.camera.fov = look.fov;
    this.camera.aspect = aspect;
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    // focus: the depth of the subject's middle (or of the look-at point, before anything has landed)
    const fwd = new Vector3();
    this.camera.getWorldDirection(fwd);
    const depthOf = (x: number, y: number, z: number) => (x - this.camera.position.x) * fwd.x + (y - this.camera.position.y) * fwd.y + (z - this.camera.position.z) * fwd.z;
    const want = depthOf(this.target.x, this.target.y, this.target.z) * (1 - landed * look.pull) + (sub ? depthOf(sub.c[0], sub.c[1], sub.c[2]) + look.focusAt * sub.R : 0) * landed * look.pull;
    // quicker to something just poked
    this.focus += (want - this.focus) * (this.focus ? (sub && (sub.prod || seconds - this.chosenAt < 0.6) ? 0.14 : 0.035) : 1);
    U.focus.value = this.focus;
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

  // Which body is in focus: the one nearest the pointer while that moves; otherwise one of the few
  // nearest the camera (nothing soft then lies in front of it), a new one every so often. When the one
  // in focus bursts, the focus stays there, on the nearest thing it let out.
  chosen: Body | null = null;
  chosenAt = -1e9;
  watchedAt = -1;
  subject(sim: Sim, seconds: number) {
    // a poke takes the focus at once, and keeps it while what came out settles
    if (sim.watchAt !== this.watchedAt) {
      this.watchedAt = sim.watchAt;
      this.chosen = sim.watch;
      this.chosenAt = seconds;
      if (this.chosen) return this.chosen;
    }
    // so does the pointer resting on one, unless something has just burst
    if (sim.hover && sim.hover.until > sim.step && !sim.hover.body.gone && !this.chosen?.gone && (!sim.watch?.gone || (sim.step - sim.watchAt) * H > 2.5)) {
      this.chosenAt = seconds;
      return (this.chosen = sim.hover.body);
    }
    const was = this.chosen;
    // where one has just burst is watched for a moment, then the nearest thing it let out
    if (was?.gone && (sim.step - was.burstAt) * H < 1.2) return was;
    if (was?.gone) {
      let near = 1e9;
      for (const b of sim.free) {
        const d = Math.hypot(b.c[0] - was.c[0], b.c[1] - was.c[1], b.c[2] - was.c[2]);
        if (d < near) {
          near = d;
          this.chosen = b;
        }
      }
      this.chosenAt = seconds;
    } else if (!was || seconds - this.chosenAt >= look.rack || seconds < this.chosenAt) {
      const p = this.camera.position;
      // colonies, and daughters once they have grown into colonies
      let pool = sim.free.filter((b) => b.grown > 0.5);
      if (!pool.length) pool = sim.free;
      const ranked = pool.map((b) => ({ b, d: Math.hypot(b.c[0] - p.x, b.c[2] - p.z) - b.R })).sort((a, b) => a.d - b.d);
      const few = ranked.slice(0, Math.min(4, ranked.length)).filter((r) => r.b !== was || ranked.length === 1);
      this.chosen = few.length ? few[Math.floor(seconds / look.rack) % few.length].b : null;
      this.chosenAt = seconds;
    }
    return this.chosen;
  }

  // Where on the floor a point of the window is: x, y from -1 to 1.
  floorAt(x: number, y: number) {
    const p = new Vector3(x, y, 0.5).unproject(this.camera).sub(this.camera.position);
    if (p.y > -1e-4) return null;
    const t = -this.camera.position.y / p.y;
    return { x: this.camera.position.x + p.x * t, z: this.camera.position.z + p.z * t };
  }

  // The line of sight through a point of the window: where it starts and which way it goes.
  sight(x: number, y: number) {
    const d = new Vector3(x, y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    return [this.camera.position.x, this.camera.position.y, this.camera.position.z, d.x, d.y, d.z] as const;
  }
}
