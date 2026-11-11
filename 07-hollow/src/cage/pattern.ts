// The cages' pattern, shared by the raymarched page (cage.html) and the mesh one (cagemesh.html): the
// settings, the finishes, where the holes are and which are neighbours, how deep each is, and the
// schedule each opens on. Nothing here draws; it's all worked out on the CPU and handed to shaders.
import { IcosahedronGeometry, Quaternion, Vector3, Vector4, WebGPURenderer } from "three/webgpu";

/** seconds to fly from one cage into the next */
export const SECONDS = 7;
/** most cages a loop can fly through, each with its own finish */
export const SLOTS = 6;
export const MOST = 128;
/** neighbours kept for each hole: a hole's edge is only ever made by its neighbours */
export const NEAR = 12;
export const cage = {
  /** holes a cage has */
  /** how the holes are laid out, and how finely, for the tilings that subdivide */
  tiling: "voronoi" as Tiling,
  fine: 2,
  /** holes, for voronoi */
  holes: 26,
  /** how much smaller each cage is than the one around it */
  ratio: 0.38,
  /** the skin's thickness against the cage's size; the tubes' width and the corners' rounding against a hole's */
  thickness: 0.035,
  tube: 0.075,
  /** how round the corners of the holes are */
  fillet: 0.07,
  /** where the opening happens: solid while smaller than `solid` cages away, open by `open` cages away */
  solid: 1.55,
  open: 0.55,
  /** how the holes open over that: the curve, and how much they take turns, in what order */
  easing: "ease out" as Easing,
  stagger: 0.6,
  order: "front, loosely" as Order,
  /** how much of a hole's own time goes on thinning its middle before it breaks through */
  dimple: 0.3,
  /** turns as cages grow, in radians per cage: about the view, and tipping across it */
  spin: 0.9,
  tip: 0.7,
  /** how unevenly the holes are spread */
  jitter: 0.55,
  seed: 4,
};

/** easings for the holes opening, 0 closed to 1 open */
export const EASINGS = ["smooth", "linear", "ease in", "ease out", "expo", "back", "elastic", "steps"] as const;
export type Easing = (typeof EASINGS)[number];
/** orders the holes take turns in */
export const ORDERS = ["front, loosely", "random", "front first", "back first", "top down", "spiral"] as const;
export type Order = (typeof ORDERS)[number];

/** what a cage can be made of: a glaze over a body, glass, or metal */
export const KINDS = ["glaze", "glass", "metal", "gold glass"] as const;
export type Kind = (typeof KINDS)[number];
export interface Finish {
  kind: Kind;
  /** glaze and metal: outside and inside colours; glass: its tint (outside) */
  outside: string;
  inside: string;
  roughness: number;
  /** a clear coat over it, glaze and metal */
  coat: number;
  /** glass: how it bends, and how strongly it takes its tint per cage size of glass passed through */
  ior: number;
  density: number;
  /** how much of the lamp inside a full wall lets through: porcelain a little, metal none, glass all */
  glow: number;
}
export const finish = (kind: Kind, outside: string, inside: string, roughness: number, coat = 0, ior = 1.45, density = 6): Finish => ({
  kind,
  outside,
  inside,
  roughness,
  coat,
  ior,
  density,
  glow: kind === "glass" ? 1 : kind === "metal" ? 0 : 0.15,
});
export const FINISHES: Record<string, Finish> = {
  ceramic: finish("glaze", "#f2ede5", "#c8714c", 0.42, 0.9),
  glass: finish("glass", "#bfe3e0", "#bfe3e0", 0),
  cobalt: finish("glaze", "#2448a8", "#f0c35a", 0.22, 1),
  "black glaze": finish("glaze", "#151515", "#b3261e", 0.14, 1),
  celadon: finish("glaze", "#9cc3a8", "#ece6d6", 0.3, 0.8),
  bisque: finish("glaze", "#e2c3a0", "#d6ab83", 0.85, 0),
  gold: finish("metal", "#f3c66f", "#d39a4a", 0.22),
  chrome: finish("metal", "#e6e8ea", "#b5b9be", 0.05),
  copper: finish("metal", "#ec9a72", "#c66c4a", 0.3),
  "amber glass": finish("glass", "#ffbe6a", "#ffbe6a", 0, 0, 1.5, 9),
};
// satin glazes from one family, for a calm loop: a soft sheen, broad highlights, a thin coat
FINISHES.ivory = finish("glaze", "#eee6da", "#eee6da", 0.45, 0.3);
FINISHES.sand = finish("glaze", "#d8c1a1", "#d8c1a1", 0.48, 0.3);
FINISHES.clay = finish("glaze", "#c46c4b", "#c46c4b", 0.46, 0.3);
FINISHES.charcoal = finish("glaze", "#2c2b2e", "#2c2b2e", 0.4, 0.35);
// Frosted glass with a gold core, from the "prepare sdf stream" demo (frosted.glsl): outside is the glass's
// tint, inside the gold, roughness the frost, coat the shell (the glass over the gold, against the wall)
FINISHES["gold in glass"] = finish("gold glass", "#dfe9ea", "#ffd38a", 0.35, 0.35, 1.5, 1.2);
// the thinner, paler bodies let more of the lamp through
FINISHES.ceramic.glow = 0.4;
FINISHES.bisque.glow = 0.3;
FINISHES.celadon.glow = 0.25;
FINISHES["black glaze"].glow = 0.04;
FINISHES.ivory.glow = 0.4;
FINISHES.sand.glow = 0.3;
FINISHES.clay.glow = 0.2;
FINISHES.charcoal.glow = 0.03;
FINISHES["gold in glass"].glow = 0.6;
/** the loop: how many cages, and what each is made of, in the order they come */
export const sequence = { cages: 3, finishes: ["ceramic", "glass", "cobalt", "gold", "black glaze", "celadon"] };

/** Chrome's shader compiler fails on a swizzle of a swizzle (`v.xy.x`), which three r182 writes; flatten them (from day 4) */
export function flattenSwizzles(renderer: WebGPURenderer) {
  const { device } = renderer.backend as unknown as { device?: GPUDevice };
  if (!device) return;
  const create = device.createShaderModule.bind(device);
  const flat = (_: string, first: string, second: string) => `.${first["xyzw".indexOf(second)]}`;
  device.createShaderModule = (descriptor) => create({ ...descriptor, code: descriptor.code.replace(/\.([xyzw]{2,4})\.([xyzw])\b/g, flat) });
}

/**
 * The holes' tilings. A hole is the patch of sphere nearer its centre than any other, shrunk by the
 * tubes, so laying the centres out regularly gives regular holes: a polyhedron's vertices make holes
 * the shape of its dual's faces.
 */
export const TILINGS = {
  /** scattered: uneven polygons, mostly five and six sided */
  voronoi: "voronoi",
  /** a geodesic sphere's face centres: triangles */
  triangles: "triangles",
  /** a cube's faces gridded and puffed out: squares, a little bulged */
  squares: "squares",
  /** an icosahedron's 12 corners: a dodecahedron's pentagons */
  pentagons: "pentagons",
  /** a geodesic sphere's corners: hexagons, and 12 pentagons, as a sphere can't be all hexagons */
  hexagons: "hexagons",
  /** an icosahedron's 30 edge middles: a rhombic triacontahedron's diamonds */
  diamonds: "diamonds",
} as const;
export type Tiling = keyof typeof TILINGS;

/** directions, without repeats */
export const unique = (list: Vector3[]) => {
  const seen = new Map<string, Vector3>();
  for (const p of list) seen.set(p.toArray().map((v) => v.toFixed(4)).join(","), p.clone().normalize());
  return [...seen.values()];
};
export const corners = (geometry: IcosahedronGeometry) => {
  const a = geometry.attributes.position;
  return unique(Array.from({ length: a.count }, (_, i) => new Vector3().fromBufferAttribute(a, i)));
};

/** the hole centres of a tiling, `fine` times subdivided where that applies */
export function layout(tiling: Tiling, holes: number, fine: number): Vector3[] {
  if (tiling === "voronoi") {
    const golden = Math.PI * (3 - Math.sqrt(5));
    return Array.from({ length: holes }, (_, i) => {
      const y = 1 - (2 * (i + 0.5)) / holes, r = Math.sqrt(1 - y * y), a = golden * i;
      return new Vector3(r * Math.cos(a), y, r * Math.sin(a));
    });
  }
  if (tiling === "pentagons") return corners(new IcosahedronGeometry(1, 0));
  if (tiling === "hexagons") return corners(new IcosahedronGeometry(1, Math.min(fine, 3)));
  if (tiling === "diamonds") {
    const twelve = corners(new IcosahedronGeometry(1, 0));
    return corners(new IcosahedronGeometry(1, 1)).filter((p) => !twelve.some((q) => q.distanceTo(p) < 1e-3));
  }
  if (tiling === "triangles") {
    const a = new IcosahedronGeometry(1, Math.min(fine - 1, 1)).attributes.position;
    const out: Vector3[] = [];
    for (let i = 0; i < a.count; i += 3) {
      out.push(new Vector3().fromBufferAttribute(a, i).add(new Vector3().fromBufferAttribute(a, i + 1)).add(new Vector3().fromBufferAttribute(a, i + 2)).normalize());
    }
    return out;
  }
  // squares: n by n on each cube face, spaced by angle so they come out near even
  const n = Math.min(fine + 1, 4);
  const out: Vector3[] = [];
  for (const axis of [0, 1, 2])
    for (const sign of [-1, 1])
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const u = Math.tan((Math.PI / 4) * ((2 * (i + 0.5)) / n - 1)), v = Math.tan((Math.PI / 4) * ((2 * (j + 0.5)) / n - 1));
          const p = [0, 0, 0];
          p[axis] = sign;
          p[(axis + 1) % 3] = u;
          p[(axis + 2) % 3] = v;
          out.push(new Vector3(...p).normalize());
        }
  return out;
}

/**
 * The hole centres, nudged by `jitter` of their spacing, and the whole lot turned so one looks straight
 * at the camera (+z): the hole it flies through. Turned, not moved, so a regular tiling stays regular.
 */
export function seeds(tiling: Tiling, holes: number, fine: number, jitter: number, seed: number) {
  let s = seed >>> 0 || 1;
  const rand = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296);
  const out = layout(tiling, holes, fine).slice(0, MOST);
  const spacing = Math.sqrt((4 * Math.PI) / out.length);
  for (const p of out) p.add(new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(jitter * spacing * 0.75)).normalize();
  let best = 0;
  out.forEach((p, i) => p.z > out[best].z && (best = i));
  const turn = new Quaternion().setFromUnitVectors(out[best].clone(), new Vector3(0, 0, 1));
  for (const p of out) p.applyQuaternion(turn);
  out[best].set(0, 0, 1);
  const count = out.length;
  while (out.length < MOST) out.push(new Vector3(0, 0, 1));
  return { points: out, count };
}

/** the nearest hole for every direction, as a map of the sphere (longitude across, from +y down) */
export const MAP = [1024, 512];
export function nearestMap(points: Vector3[], n: number) {
  const [w, h] = MAP;
  const data = new Uint8Array(w * h * 4);
  const d = new Vector3();
  for (let y = 0; y < h; y++) {
    const theta = ((y + 0.5) / h) * Math.PI;
    for (let x = 0; x < w; x++) {
      const phi = ((x + 0.5) / w - 0.5) * Math.PI * 2;
      d.set(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
      let best = 0, f = -2;
      for (let k = 0; k < n; k++) {
        const c = d.dot(points[k]);
        if (c > f) (f = c), (best = k);
      }
      data[(y * w + x) * 4] = best;
      data[(y * w + x) * 4 + 3] = 255;
    }
  }
  return data;
}

/**
 * Which holes share an edge, NEAR per hole, -1 where there are fewer: found by sampling directions all
 * over the sphere, each one's nearest two holes being neighbours.
 */
export function neighbours(points: Vector3[], n: number) {
  const sets = Array.from({ length: n }, () => new Set<number>());
  const golden = Math.PI * (3 - Math.sqrt(5));
  const d = new Vector3();
  const samples = 40000;
  for (let i = 0; i < samples; i++) {
    const y = 1 - (2 * (i + 0.5)) / samples, r = Math.sqrt(1 - y * y), a = golden * i;
    d.set(r * Math.cos(a), y, r * Math.sin(a));
    let first = -1, second = -1, f = -2, g = -2;
    for (let k = 0; k < n; k++) {
      const c = d.dot(points[k]);
      if (c > f) (second = first), (g = f), (first = k), (f = c);
      else if (c > g) (second = k), (g = c);
    }
    sets[first].add(second);
    sets[second].add(first);
  }
  const out = new Array(MOST * NEAR).fill(-1);
  sets.forEach((set, k) => [...set].slice(0, NEAR).forEach((j, m) => (out[k * NEAR + m] = j)));
  return out;
}

/** samples in the easing's table */
export const CURVE = 128;
/** the easings, 0 closed to 1 open; back and elastic go past 1, thinning the tubes past their width */
export function ease(name: Easing, t: number) {
  const b = t - 1;
  switch (name) {
    case "linear":
      return t;
    case "ease in":
      return t * t * t;
    case "ease out":
      return b * b * b + 1;
    case "expo":
      return t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : 1 - 2 ** (10 - 20 * t) / 2;
    case "back":
      return 1 + 2.70158 * b * b * b + 1.70158 * b * b;
    case "elastic":
      return t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin(((10 * t - 0.75) * Math.PI * 2) / 3) + 1;
    case "steps": {
      const f = t * 4 - Math.floor(t * 4), k = Math.min((f - 0.7) / 0.3, 1);
      const smooth = f < 0.7 ? 0 : k * k * (3 - 2 * k);
      return t >= 1 ? 1 : (Math.floor(t * 4) + smooth) / 4;
    }
    default:
      return t * t * (3 - 2 * t);
  }
}
export const easeTable = (name: Easing) => Array.from({ length: CURVE }, (_, i) => ease(name, i / (CURVE - 1)));
/**
 * What each hole needs to open on its own schedule, as in spite's day 7 (codevember-2026/7, hollow.js):
 * x its turn, 0 first to 1 last, by the order; y how deep its middle is, its largest distance to its
 * border (the shader's soft one, so it matches exactly), which is where it breaks through; z a little
 * difference in its final strut. Holes are as laid out in the cage's own frame.
 */
export function holesOf(points: Vector3[], count: number, near: number[], order: Order, seed: number, fillet: number) {
  const out = Array.from({ length: MOST }, () => new Vector4(0, 1, 1, 0));
  const hash = (i: number, k: number) => Math.abs((Math.sin(i * 12.9898 + k * 78.233 + seed * 3.17) * 43758.5453) % 1);
  for (let i = 0; i < count; i++) {
    const a = points[i], front = (1 - a.z) / 2;
    const turn =
      order === "front, loosely" ? 0.45 * front + 0.5 * hash(i, 1) :
      order === "random" ? hash(i, 1) :
      order === "front first" ? front :
      order === "back first" ? 1 - front :
      order === "top down" ? (1 - a.y) / 2 :
      (Math.atan2(a.y, a.x) / (Math.PI * 2) + 0.5 + front * 2) % 1;
    out[i].set(turn, 0, 0.88 + 0.24 * hash(i, 2), 0);
  }
  // each hole's deepest point, over directions all round
  const golden = Math.PI * (3 - Math.sqrt(5));
  const d = new Vector3(), ab = new Vector3();
  const samples = 30000;
  for (let s = 0; s < samples; s++) {
    const y = 1 - (2 * (s + 0.5)) / samples, r = Math.sqrt(1 - y * y), t = golden * s;
    d.set(r * Math.cos(t), y, r * Math.sin(t));
    let which = 0, best = -2;
    for (let k = 0; k < count; k++) {
      const c = d.dot(points[k]);
      if (c > best) (best = c), (which = k);
    }
    let sum = 0;
    for (let m = 0; m < NEAR; m++) {
      const j = near[which * NEAR + m];
      if (j < 0) continue;
      ab.subVectors(points[which], points[j]);
      sum += Math.exp(-d.dot(ab) / ab.length() / fillet);
    }
    const edge = -fillet * Math.log(Math.max(sum, 1e-30));
    out[which].y = Math.max(out[which].y, edge);
  }
  return out;
}

/** cages whose struts are worked out each frame: from 3 cages in from the one being passed to 3 out */
export const LEVELS = 7;
/**
 * How wide the struts round one hole are, against the cage's size, as spite's day 7 opens a cell: closed
 * while the struts are wider than the hole is deep (plus a lip); then a dimple, the middle thinning from
 * both faces as they narrow to its depth; through there; and wider, as the easing goes, to its own final
 * strut. Its time is its own share of the way from `solid` cages off to `open`, when holes take turns. Only
 * the cage's place (u) counts, so it loops.
 */
export function strut(u: number, hole: Vector4, curve: number[], cell: number) {
  const x = Math.min(Math.max((u + cage.solid) / (cage.solid - cage.open), 0), 1);
  const t = Math.min(Math.max((x - hole.x * cage.stagger) / (1 - cage.stagger), 0), 1);
  const deepest = hole.y, lip = cage.thickness;
  const wanted = cage.tube * cell * hole.z;
  const final = Math.min(wanted, deepest * 0.62);
  // a hole too small to open cleanly stays shut
  if (deepest < wanted * 1.5) return deepest + lip * 2;
  if (t < cage.dimple) {
    // the dimple: from a lip past its depth, where nothing shows, down to its depth, thinned to nothing
    const k = t / cage.dimple;
    return deepest + lip * 1.05 * (1 - k * k * (3 - 2 * k));
  }
  // through, and wider, along the easing
  const at = ((t - cage.dimple) / (1 - cage.dimple)) * (CURVE - 1);
  const low = Math.floor(at), high = Math.min(low + 1, CURVE - 1);
  const eased = curve[low] + (curve[high] - curve[low]) * (at - low);
  return Math.max(deepest - (deepest - final) * eased, final * 0.2);
}

