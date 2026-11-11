// Rigid lumpy balls set in a slab, a closed path winding between them, and a chain of soft bodies
// pulled slowly along it. Each soft body follows an anchor sliding along the path on a spring, so it
// lags and squeezes where the balls crowd the path.

import { radical, type Bubble } from "../foam.ts";

export type PathSettings = {
  /** half size of the slab */
  slab: [number, number, number];
  balls: number;
  /** soft body radius */
  size: number;
  spread: number;
  /** soft bodies along the loop */
  count: number;
  /** how much room the balls leave the path, as a share of a soft body's radius */
  squeeze: number;
  /** how far the path strays towards the slab's faces */
  depth: number;
  pull: number;
  pressure: number;
  stiffness: number;
  damping: number;
  seed: number;
};

export const MAX_BALLS = 24;
export const MAX_SOFT = 48;

export type Ball = {
  centre: number[];
  radii: number[];
  /** rows of a rotation, world to ball */
  rot: number[][];
};

function random(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** a bound on the distance to an ellipsoid, the usual one from its scaled gradient */
export function ballSdf(b: Ball, x: number, y: number, z: number) {
  const dx = x - b.centre[0], dy = y - b.centre[1], dz = z - b.centre[2];
  const l = [0, 1, 2].map((k) => b.rot[k][0] * dx + b.rot[k][1] * dy + b.rot[k][2] * dz);
  let k0 = 0, k1 = 0;
  for (let k = 0; k < 3; k++) {
    k0 += (l[k] / b.radii[k]) ** 2;
    k1 += (l[k] / (b.radii[k] * b.radii[k])) ** 2;
  }
  k0 = Math.sqrt(k0);
  k1 = Math.sqrt(k1);
  return k1 < 1e-9 ? -Math.min(...b.radii) : (k0 * (k0 - 1)) / k1;
}

const sphereVolume = (r: number) => (4 / 3) * Math.PI * r * r * r;
const capVolume = (r: number, a: number) => {
  if (a >= r) return 0;
  if (a <= -r) return sphereVolume(r);
  const h = r - a;
  return (Math.PI * h * h * (3 * r - h)) / 3;
};

export class PathFoam {
  settings: PathSettings;
  /** the path, resampled evenly, and its length */
  path: number[][] = [];
  length = 1;
  balls: Ball[] = [];
  bubbles: Bubble[] = [];
  /** where each soft body's anchor starts along the path, 0..1 */
  slots: number[] = [];

  constructor(settings: PathSettings) {
    this.settings = settings;
    this.reset();
  }

  reset() {
    const s = this.settings;
    const rand = random(s.seed * 7919 + 101);
    const [bx, by, bz] = s.slab;

    // a closed loop round the slab, its radius wandering in and out, and weaving front to back like a
    // needle, so the channel leaves bridges: a loop cut right through a slab would cut out an island.
    // An even count, so the weave closes.
    const K = 10;
    const controls: number[][] = [];
    for (let k = 0; k < K; k++) {
      const a = (2 * Math.PI * (k + (rand() - 0.5) * 0.5)) / K;
      const r = 0.45 + 0.55 * rand();
      controls.push([Math.cos(a) * r * bx * 0.9, Math.sin(a) * r * by * 0.9, (k % 2 ? 1 : -1) * bz * s.depth * (0.6 + 0.4 * rand())]);
    }
    const fine: number[][] = [];
    const per = 64;
    for (let k = 0; k < K; k++) {
      const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((o) => controls[(k + o + K) % K]);
      for (let i = 0; i < per; i++) {
        const t = i / per, t2 = t * t, t3 = t2 * t;
        fine.push(
          [0, 1, 2].map(
            (c) =>
              0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3),
          ),
        );
      }
    }
    // even spacing by arc length
    const cum = [0];
    for (let i = 1; i <= fine.length; i++) {
      const a = fine[i - 1], b = fine[i % fine.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    this.length = cum[fine.length];
    const M = 512;
    this.path = [];
    let j = 0;
    for (let i = 0; i < M; i++) {
      const target = (i / M) * this.length;
      while (cum[j + 1] < target) j++;
      const f = (target - cum[j]) / (cum[j + 1] - cum[j]);
      const a = fine[j], b = fine[(j + 1) % fine.length];
      this.path.push([0, 1, 2].map((c) => a[c] + (b[c] - a[c]) * f));
    }

    // balls in the slab, each leaving the path less room than a soft body needs, so it has to squeeze
    this.balls = [];
    const room = s.size * s.squeeze;
    for (let tries = 0; tries < 6000 && this.balls.length < s.balls; tries++) {
      const r = s.size * (0.9 + 1.0 * rand());
      const ball: Ball = {
        centre: [(rand() * 2 - 1) * bx, (rand() * 2 - 1) * by, (rand() * 2 - 1) * bz * 0.4],
        radii: [r * (0.85 + 0.3 * rand()), r * (0.85 + 0.3 * rand()), r * (0.85 + 0.3 * rand())],
        rot: rotation(rand(), rand(), rand()),
      };
      let gap = Infinity;
      for (const p of this.path) gap = Math.min(gap, ballSdf(ball, p[0], p[1], p[2]));
      if (gap < room || gap > s.size * 1.1) continue;
      // balls may touch but not swallow each other
      if (this.balls.some((o) => Math.hypot(...[0, 1, 2].map((k) => o.centre[k] - ball.centre[k])) < (Math.max(...o.radii) + r) * 0.8)) continue;
      this.balls.push(ball);
    }

    this.bubbles = [];
    this.slots = [];
    for (let i = 0; i < s.count; i++) {
      const slot = i / s.count;
      const p = this.at(slot);
      const r0 = s.size * (1 + s.spread * (rand() * 2 - 1));
      this.slots.push(slot);
      this.bubbles.push({ x: Float64Array.from(p), v: new Float64Array(3), r0, r: r0, phase: 0 });
    }
  }

  /** a point on the path, u in 0..1 */
  at(u: number) {
    const M = this.path.length;
    const f = (((u % 1) + 1) % 1) * M;
    const i = Math.floor(f), t = f - i;
    const a = this.path[i % M], b = this.path[(i + 1) % M];
    return [0, 1, 2].map((c) => a[c] + (b[c] - a[c]) * t);
  }

  /** advance; travel is how far round the loop the anchors are, 0..1 */
  step(dt: number, travel: number) {
    const s = this.settings;
    const bs = this.bubbles;
    const n = bs.length;
    const force = new Float64Array(n * 3);
    const e = 1e-3;
    for (let i = 0; i < n; i++) {
      const a = bs[i];
      // the anchor's pull
      const anchor = this.at(this.slots[i] + travel);
      for (let k = 0; k < 3; k++) force[i * 3 + k] += s.pull * (anchor[k] - a.x[k]) * a.r0 * a.r0;
      for (let j = i + 1; j < n; j++) {
        const b = bs[j];
        const dx = b.x[0] - a.x[0], dy = b.x[1] - a.x[1], dz = b.x[2] - a.x[2];
        const d = Math.hypot(dx, dy, dz) || 1e-9;
        const overlap = a.r + b.r - d;
        if (overlap <= 0) continue;
        const nx = dx / d, ny = dy / d, nz = dz / d;
        const rr = (a.r * b.r) / (a.r + b.r);
        const rv = (b.v[0] - a.v[0]) * nx + (b.v[1] - a.v[1]) * ny + (b.v[2] - a.v[2]) * nz;
        const f = 0.3 * (s.stiffness * overlap * rr - s.damping * rv * rr);
        force[i * 3] -= f * nx; force[i * 3 + 1] -= f * ny; force[i * 3 + 2] -= f * nz;
        force[j * 3] += f * nx; force[j * 3 + 1] += f * ny; force[j * 3 + 2] += f * nz;
      }
      // the balls push back, but only once a body sinks deeper than the room the path leaves it, so
      // the anchors can always drag a body through; how deep it sinks is its squash
      const free = a.r * s.squeeze * 0.9;
      for (const ball of this.balls) {
        const d = ballSdf(ball, a.x[0], a.x[1], a.x[2]);
        const overlap = free - d;
        if (overlap <= 0) continue;
        const g = [
          ballSdf(ball, a.x[0] + e, a.x[1], a.x[2]) - ballSdf(ball, a.x[0] - e, a.x[1], a.x[2]),
          ballSdf(ball, a.x[0], a.x[1] + e, a.x[2]) - ballSdf(ball, a.x[0], a.x[1] - e, a.x[2]),
          ballSdf(ball, a.x[0], a.x[1], a.x[2] + e) - ballSdf(ball, a.x[0], a.x[1], a.x[2] - e),
        ];
        const gl = Math.hypot(g[0], g[1], g[2]) || 1;
        const rv = (a.v[0] * g[0] + a.v[1] * g[1] + a.v[2] * g[2]) / gl;
        const f = 0.3 * (s.stiffness * overlap * a.r - s.damping * Math.min(rv, 0) * a.r);
        for (let k = 0; k < 3; k++) force[i * 3 + k] += (f * g[k]) / gl;
      }
    }
    for (let i = 0; i < n; i++) {
      const b = bs[i];
      const mass = b.r0 ** 3;
      for (let k = 0; k < 3; k++) {
        b.v[k] += ((force[i * 3 + k] - s.damping * 0.3 * b.v[k] * b.r) / mass) * dt;
        b.x[k] += b.v[k] * dt;
      }
    }
    this.swell();
  }

  /** squashed bodies swell into free space, against neighbours and balls alike */
  swell() {
    const s = this.settings;
    const bs = this.bubbles;
    for (const a of bs) {
      let lost = 0;
      for (const b of bs) {
        if (b === a) continue;
        const d = Math.hypot(b.x[0] - a.x[0], b.x[1] - a.x[1], b.x[2] - a.x[2]);
        if (d < a.r + b.r) lost += capVolume(a.r, radical(d, a.r, b.r));
      }
      // a ball is near enough a plane where it cuts a soft body
      for (const ball of this.balls) lost += capVolume(a.r, ballSdf(ball, a.x[0], a.x[1], a.x[2]));
      const want = sphereVolume(a.r0);
      const have = Math.max(sphereVolume(a.r) - lost, want * 0.2);
      const target = a.r * Math.cbrt(1 + s.pressure * (want / have - 1));
      a.r += (Math.min(Math.max(target, a.r0), a.r0 * 1.5) - a.r) * 0.1;
    }
  }

  /** balls for the GPU: centre, radii, and three rows of rotation */
  packBalls(out: Float32Array) {
    this.balls.forEach((b, i) => {
      const o = i * 20;
      out.set([...b.centre, 0, ...b.radii, 0, ...b.rot[0], 0, ...b.rot[1], 0, ...b.rot[2], 0], o);
    });
  }
}

function rotation(a: number, b: number, c: number) {
  // a uniform random rotation from three numbers (Shoemake)
  const q = [
    Math.sqrt(1 - a) * Math.sin(2 * Math.PI * b),
    Math.sqrt(1 - a) * Math.cos(2 * Math.PI * b),
    Math.sqrt(a) * Math.sin(2 * Math.PI * c),
    Math.sqrt(a) * Math.cos(2 * Math.PI * c),
  ];
  const [x, y, z, w] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)],
    [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)],
    [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)],
  ];
}
