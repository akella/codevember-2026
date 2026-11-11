// Where the shapes go: a loose cloud, and shells around solids that aren't there: a cube, a tetrahedron,
// a torus, Suzanne. Every shape sits outside the missing solid with a flat side on its surface, so the
// solid shows as the hollow they leave.
import { Quaternion, Vector3 } from "three";

export type Kind = "sphere" | "cube" | "tetra";
export const KINDS: Kind[] = ["sphere", "cube", "tetra"];

/** a shape's own measures, from its size */
export const measure = {
  /** the geometry's scale against size: half the cube's side, the tetrahedron's circumradius */
  scale: { sphere: 1, cube: 0.8, tetra: 1.35 } as Record<Kind, number>,
  /** centre to the side that lies on a face */
  contact: { sphere: 1, cube: 0.8, tetra: 1.35 / 3 } as Record<Kind, number>,
  /** how much of a face it covers, as a radius */
  footprint: { sphere: 1, cube: 0.95, tetra: 0.95 } as Record<Kind, number>,
  /** for collisions */
  bound: { sphere: 1, cube: 1.15, tetra: 1.0 } as Record<Kind, number>,
};

/** the side of each kind's geometry that lies on a face, in its own space */
const down: Record<Kind, Vector3> = {
  sphere: new Vector3(0, -1, 0),
  cube: new Vector3(0, -1, 0),
  // three's TetrahedronGeometry: the face opposite the corner at (1, 1, 1)
  tetra: new Vector3(-1, -1, -1).normalize(),
};

export type Spot = { p: Vector3; n: Vector3 };

export interface Surface {
  /** nearest point on the surface, and the outward normal there */
  project(p: Vector3): Spot;
  /**
   * where the ray from the centre along `dir` leaves the solid; only for solids every such ray leaves
   * once. Others give `sample` instead: a point spread evenly by area.
   */
  cast?(dir: Vector3): Vector3;
  sample?(rand: () => number): Vector3;
  area: number;
}

const TAU = Math.PI * 2;

/** a torus round the y axis: ring radius R, tube radius r */
export function torus(R: number, r: number): Surface {
  const at = (theta: number, phi: number) => {
    const n = new Vector3(Math.cos(phi) * Math.cos(theta), Math.sin(phi), Math.cos(phi) * Math.sin(theta));
    return new Vector3(R * Math.cos(theta), 0, R * Math.sin(theta)).addScaledVector(n, r);
  };
  return {
    area: 4 * Math.PI * Math.PI * R * r,
    project(p) {
      const ring = new Vector3(p.x, 0, p.z);
      const l = ring.length();
      if (l < 1e-6) ring.set(R, 0, 0);
      else ring.multiplyScalar(R / l);
      const n = p.clone().sub(ring);
      const d = n.length();
      if (d < 1e-6) n.set(0, 1, 0);
      else n.divideScalar(d);
      return { p: ring.addScaledVector(n, r), n };
    },
    sample(rand) {
      // the outside of the tube has more surface than the inside: keep points in proportion
      for (;;) {
        const phi = rand() * TAU;
        if (rand() * (R + r) < R + r * Math.cos(phi)) return at(rand() * TAU, phi);
      }
    },
  };
}

/**
 * Any closed triangle mesh, scaled. Nearest points come from a grid of the triangles, searched outward
 * ring by ring until no nearer triangle can be left.
 */
export function mesh(position: ArrayLike<number>, index: ArrayLike<number>, scale: number): Surface {
  const count = index.length / 3;
  const tri = new Float32Array(count * 9);
  const normal = new Float32Array(count * 3);
  const areas = new Float64Array(count);
  let area = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < count; t++) {
    for (let c = 0; c < 3; c++)
      for (let a = 0; a < 3; a++) {
        const v = position[index[t * 3 + c] * 3 + a] * scale;
        tri[t * 9 + c * 3 + a] = v;
        lo[a] = Math.min(lo[a], v);
        hi[a] = Math.max(hi[a], v);
      }
    const o = t * 9;
    const ux = tri[o + 3] - tri[o], uy = tri[o + 4] - tri[o + 1], uz = tri[o + 5] - tri[o + 2];
    const vx = tri[o + 6] - tri[o], vy = tri[o + 7] - tri[o + 1], vz = tri[o + 8] - tri[o + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    normal.set([nx / l, ny / l, nz / l], t * 3);
    areas[t] = area += l / 2;
  }
  const N = 16;
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / N + 1e-6;
  const cells: number[][] = Array.from({ length: N * N * N }, () => []);
  const cellOf = (v: number, a: number) => Math.min(N - 1, Math.max(0, Math.floor((v - lo[a]) / size)));
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const from = [0, 1, 2].map((a) => cellOf(Math.min(tri[o + a], tri[o + 3 + a], tri[o + 6 + a]), a));
    const to = [0, 1, 2].map((a) => cellOf(Math.max(tri[o + a], tri[o + 3 + a], tri[o + 6 + a]), a));
    for (let x = from[0]; x <= to[0]; x++) for (let y = from[1]; y <= to[1]; y++) for (let z = from[2]; z <= to[2]; z++) cells[(z * N + y) * N + x].push(t);
  }
  const q = new Float64Array(3);
  const nearest = (px: number, py: number, pz: number) => {
    const c = [cellOf(px, 0), cellOf(py, 1), cellOf(pz, 2)];
    // how far the point lies outside the grid, which every ring has to make up first
    const outside = Math.hypot(...[px, py, pz].map((v, a) => Math.max(lo[a] - v, v - hi[a], 0)));
    let best = Infinity, bestT = 0;
    const bx = new Float64Array(3);
    for (let ring = 0; ring < N; ring++) {
      for (let x = c[0] - ring; x <= c[0] + ring; x++)
        for (let y = c[1] - ring; y <= c[1] + ring; y++)
          for (let z = c[2] - ring; z <= c[2] + ring; z++) {
            if (Math.max(Math.abs(x - c[0]), Math.abs(y - c[1]), Math.abs(z - c[2])) !== ring) continue;
            if (x < 0 || y < 0 || z < 0 || x >= N || y >= N || z >= N) continue;
            for (const t of cells[(z * N + y) * N + x]) {
              closestOnTriangleAt(px, py, pz, tri, t * 9, q);
              const d = (q[0] - px) ** 2 + (q[1] - py) ** 2 + (q[2] - pz) ** 2;
              if (d < best) (best = d), (bestT = t), bx.set(q);
            }
          }
      // nothing in a further ring can beat what's been found
      if (best < (outside + ring * size) ** 2) break;
    }
    return { p: new Vector3(bx[0], bx[1], bx[2]), n: new Vector3(normal[bestT * 3], normal[bestT * 3 + 1], normal[bestT * 3 + 2]) };
  };
  return {
    area,
    project: (p) => nearest(p.x, p.y, p.z),
    sample(rand) {
      // a triangle by area, then a point evenly inside it
      const target = rand() * area;
      let a = 0, b = count - 1;
      while (a < b) {
        const m = (a + b) >> 1;
        if (areas[m] < target) a = m + 1;
        else b = m;
      }
      let u = rand(), v = rand();
      if (u + v > 1) (u = 1 - u), (v = 1 - v);
      const o = a * 9;
      return new Vector3(
        tri[o] + u * (tri[o + 3] - tri[o]) + v * (tri[o + 6] - tri[o]),
        tri[o + 1] + u * (tri[o + 4] - tri[o + 1]) + v * (tri[o + 7] - tri[o + 1]),
        tri[o + 2] + u * (tri[o + 5] - tri[o + 2]) + v * (tri[o + 8] - tri[o + 2]),
      );
    },
  };
}

/** Ericson's closest point on a triangle, on plain numbers: triangle at tri[o..o+9], answer in out */
function closestOnTriangleAt(px: number, py: number, pz: number, tri: Float32Array, o: number, out: Float64Array) {
  const ax = tri[o], ay = tri[o + 1], az = tri[o + 2];
  const abx = tri[o + 3] - ax, aby = tri[o + 4] - ay, abz = tri[o + 5] - az;
  const acx = tri[o + 6] - ax, acy = tri[o + 7] - ay, acz = tri[o + 8] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const put = (s: number, t: number) => out.set([ax + s * abx + t * acx, ay + s * aby + t * acy, az + s * abz + t * acz]);
  if (d1 <= 0 && d2 <= 0) return put(0, 0);
  const bpx = px - tri[o + 3], bpy = py - tri[o + 4], bpz = pz - tri[o + 5];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return put(1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return put(d1 / (d1 - d3), 0);
  const cpx = px - tri[o + 6], cpy = py - tri[o + 7], cpz = pz - tri[o + 8];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return put(0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return put(0, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return put(1 - w, w);
  }
  const den = 1 / (va + vb + vc);
  return put(vb * den, vc * den);
}

/**
 * Starting places on a surface that has no `cast`: as many even samples as shapes, each shape taking
 * the free one most in its own direction from the centre, so it has a short way to go between figures.
 */
export function spread(surface: Surface, dirs: Vector3[], rand: () => number) {
  if (surface.cast) return dirs.map((d) => surface.cast!(d));
  const samples = dirs.map(() => surface.sample!(rand));
  const unit = samples.map((s) => s.clone().normalize());
  const taken = new Uint8Array(samples.length);
  const order = dirs.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const out: Vector3[] = new Array(dirs.length);
  for (const i of order) {
    let best = -1, closest = -Infinity;
    for (let j = 0; j < samples.length; j++) {
      if (taken[j]) continue;
      const d = unit[j].dot(dirs[i]);
      if (d > closest) (closest = d), (best = j);
    }
    taken[best] = 1;
    out[i] = samples[best];
  }
  return out;
}

export function cube(h: number): Surface {
  return {
    area: 24 * h * h,
    project(p) {
      const a = [Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)];
      const axis = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
      const q = new Vector3(Math.max(-h, Math.min(h, p.x)), Math.max(-h, Math.min(h, p.y)), Math.max(-h, Math.min(h, p.z)));
      const n = new Vector3();
      const s = Math.sign(p.getComponent(axis)) || 1;
      q.setComponent(axis, s * h);
      n.setComponent(axis, s);
      return { p: q, n };
    },
    cast(dir) {
      const m = Math.max(Math.abs(dir.x), Math.abs(dir.y), Math.abs(dir.z));
      return dir.clone().multiplyScalar(h / m);
    },
  };
}

export function tetrahedron(r: number): Surface {
  const corners = [new Vector3(1, 1, 1), new Vector3(-1, -1, 1), new Vector3(-1, 1, -1), new Vector3(1, -1, -1)].map((v) => v.normalize().multiplyScalar(r));
  const faces = corners.map((_, k) => {
    const tri = corners.filter((_, j) => j !== k);
    return { n: corners[k].clone().normalize().negate(), tri };
  });
  const inradius = r / 3;
  const edge = (r * 4) / Math.sqrt(6);
  return {
    area: Math.sqrt(3) * edge * edge,
    project(p) {
      let best = faces[0];
      let most = -Infinity;
      for (const f of faces) {
        const d = p.dot(f.n) - inradius;
        if (d > most) (most = d), (best = f);
      }
      return { p: closestOnTriangle(p, best.tri[0], best.tri[1], best.tri[2]), n: best.n.clone() };
    },
    cast(dir) {
      let t = Infinity;
      for (const f of faces) {
        const c = dir.dot(f.n);
        if (c > 1e-6) t = Math.min(t, inradius / c);
      }
      return dir.clone().multiplyScalar(t);
    },
  };
}

function closestOnTriangle(p: Vector3, a: Vector3, b: Vector3, c: Vector3) {
  // Ericson, Real-Time Collision Detection 5.1.5
  const ab = b.clone().sub(a), ac = c.clone().sub(a), ap = p.clone().sub(a);
  const d1 = ab.dot(ap), d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return a.clone();
  const bp = p.clone().sub(b);
  const d3 = ab.dot(bp), d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return b.clone();
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return a.clone().addScaledVector(ab, d1 / (d1 - d3));
  const cp = p.clone().sub(c);
  const d5 = ab.dot(cp), d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return c.clone();
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return a.clone().addScaledVector(ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return b.clone().addScaledVector(c.clone().sub(b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const den = 1 / (va + vb + vc);
  return a.clone().addScaledVector(ab, vb * den).addScaledVector(ac, vc * den);
}

/**
 * Spread points over a surface so footprints don't overlap: push overlapping pairs apart and project
 * back, a few dozen times. Starting points keep their order, so two shells relaxed from matching
 * starts stay matched, and shapes travel to nearby places.
 */
export function relax(surface: Surface, start: Vector3[], radii: number[], rounds = 60): Spot[] {
  const n = start.length;
  const p = start.map((s) => surface.project(s).p);
  const cell = 2 * Math.max(...radii);
  const push = new Vector3();
  for (let round = 0; round < rounds; round++) {
    const grid = new Map<string, number[]>();
    const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
    p.forEach((q, i) => {
      const k = key(Math.floor(q.x / cell), Math.floor(q.y / cell), Math.floor(q.z / cell));
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
    });
    const moves = p.map(() => new Vector3());
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(p[i].x / cell), cy = Math.floor(p[i].y / cell), cz = Math.floor(p[i].z / cell);
      for (let x = -1; x <= 1; x++)
        for (let y = -1; y <= 1; y++)
          for (let z = -1; z <= 1; z++) {
            for (const j of grid.get(key(cx + x, cy + y, cz + z)) ?? []) {
              if (j <= i) continue;
              push.subVectors(p[i], p[j]);
              const d = push.length();
              const want = (radii[i] + radii[j]) * 1.04;
              if (d >= want) continue;
              if (d < 1e-6) push.set(Math.sin(i * 12.9898), Math.cos(j * 78.233), Math.sin(i + j)).normalize();
              else push.divideScalar(d);
              const amount = (want - d) * 0.5;
              moves[i].addScaledVector(push, amount);
              moves[j].addScaledVector(push, -amount);
            }
          }
    }
    for (let i = 0; i < n; i++) p[i] = surface.project(p[i].add(moves[i])).p;
  }
  return p.map((q) => surface.project(q));
}

/** turn a shape so its flat side lies on a face with outward normal `n`, then twist it about `n` */
export function lieOn(kind: Kind, n: Vector3, twist: number) {
  const align = new Quaternion().setFromUnitVectors(down[kind], n.clone().negate());
  return new Quaternion().setFromAxisAngle(n, twist).multiply(align);
}

/** a small seeded generator, so a layout can be had again */
export function random(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand: () => number) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}
