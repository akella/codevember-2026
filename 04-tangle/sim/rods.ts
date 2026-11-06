// Discrete Elastic Rods (Bergou, Wardetzky, Robinson, Audoly, Grinspun, SIGGRAPH 2008), as the
// paper runs it: explicit bending and twisting forces, a quasistatic material frame, and
// inextensibility by fast projection. Contacts with friction are added, and so is the part
// that makes a loop: delayed feedback towards the state one period ago.
//
// One array per quantity, all ropes end to end. Node i of rope r sits at r * stride + i, and
// edge i joins nodes i and i + 1. Every period the arrays are shifted back by K nodes and one
// pitch, so a closed loop shows up as the same numbers at the same phase.

import { curveAt, headProgress, type Params, type Rope } from "./paths.ts";

const { sqrt, floor, min, max, PI, atan2, cos, sin } = Math;

/** units/s. Nothing moves near this: it only stops one bad step from running away */
const SPEED_LIMIT = 30;

const smooth01 = (a: number, b: number, x: number) => {
  const t = min(1, max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Rods {
  p: Params;
  ropes: Rope[];
  stride: number;
  /** nodes at which each rope's head begins a loop */
  h0: number;

  x: Float64Array;
  v: Float64Array;
  xPrev: Float64Array;
  force: Float64Array;
  w: Float64Array;
  /** laid and current rest length, per edge */
  laid: Float64Array;
  rest: Float64Array;
  /** tangent and reference director per edge */
  t: Float64Array;
  u: Float64Array;
  theta: Float64Array;
  /** reference twist per vertex */
  refTwist: Float64Array;

  /** first and last free node, per rope */
  lo: Int32Array;
  hi: Int32Array;
  head: Float64Array;

  time = 0;
  dt: number;
  step = 0;
  stepsPerLoop: number;
  /** ramps the shrink in from the laid state */
  warm = 0;
  warmSeconds = 3;

  // tridiagonal scratch
  private a: Float64Array;
  private b: Float64Array;
  private c: Float64Array;
  private d: Float64Array;

  // collision candidates
  private pairs = new Int32Array(1 << 20);
  private pairCount = 0;
  private buckets = new Int32Array(1 << 17);
  private next: Int32Array;
  private cell: Int32Array;

  /** delayed feedback: where every node was one period ago, per recorded frame */
  feedback = 0;
  feedbackDamp = 0;
  history: Float32Array[] = [];
  historyRate = 60;
  private target: Float32Array | null = null;
  private targetNext: Float32Array | null = null;
  private targetMix = 0;

  contacts = 0;

  constructor(p: Params, ropes: Rope[]) {
    this.p = p;
    this.ropes = ropes;
    this.dt = 1 / p.rate;
    this.stepsPerLoop = Math.round(p.period * p.rate);
    this.h0 = p.window + p.lag + 4;
    const longest = max(...ropes.map((r) => r.K));
    this.stride = this.h0 + longest + p.lag + 8;
    const n = this.stride * ropes.length;
    this.x = new Float64Array(n * 3);
    this.v = new Float64Array(n * 3);
    this.xPrev = new Float64Array(n * 3);
    this.force = new Float64Array(n * 3);
    this.w = new Float64Array(n);
    this.laid = new Float64Array(n);
    this.rest = new Float64Array(n);
    this.t = new Float64Array(n * 3);
    this.u = new Float64Array(n * 3);
    this.theta = new Float64Array(n);
    this.refTwist = new Float64Array(n);
    this.lo = new Int32Array(ropes.length);
    this.hi = new Int32Array(ropes.length);
    this.head = new Float64Array(ropes.length);
    this.a = new Float64Array(this.stride);
    this.b = new Float64Array(this.stride);
    this.c = new Float64Array(this.stride);
    this.d = new Float64Array(this.stride);
    this.next = new Int32Array(n);
    this.cell = new Int32Array(n * 3);
    for (const rope of ropes) this.lay(rope, 0);
    this.updateHeads();
  }

  /** the curve parameter of array index i, in laid nodes */
  private laidIndex(rope: Rope, i: number) {
    return i - this.h0 + rope.start * rope.K;
  }

  /** Fills nodes from `from` to the end of the array along the rope's curve */
  private lay(rope: Rope, from: number) {
    const { x, laid, t, u, theta, stride, p } = this;
    const o = rope.index * stride;
    for (let i = from; i < stride; i++) curveAt(rope, p.pitch, this.laidIndex(rope, i), x, (o + i) * 3);
    for (let i = max(0, from - 1); i < stride - 1; i++) {
      const a = (o + i) * 3;
      const dx = x[a + 3] - x[a];
      const dy = x[a + 4] - x[a + 1];
      const dz = x[a + 5] - x[a + 2];
      const l = sqrt(dx * dx + dy * dy + dz * dz);
      laid[o + i] = l;
      this.rest[o + i] = l;
      t[a] = dx / l;
      t[a + 1] = dy / l;
      t[a + 2] = dz / l;
    }
    // reference directors: parallel transport from the edge before. The material director is
    // fixed to the curve instead, so it repeats every loop even though the transported one
    // picks up a holonomy
    const q = [0, 0, 0];
    for (let i = from; i < stride - 1; i++) {
      const e = (o + i) * 3;
      if (i === 0) {
        const ax = [1, 0, 0];
        if (Math.abs(t[e]) > 0.9) (ax[0] = 0), (ax[1] = 1);
        const d = ax[0] * t[e] + ax[1] * t[e + 1] + ax[2] * t[e + 2];
        const vx = ax[0] - d * t[e];
        const vy = ax[1] - d * t[e + 1];
        const vz = ax[2] - d * t[e + 2];
        const l = 1 / sqrt(vx * vx + vy * vy + vz * vz);
        u[e] = vx * l;
        u[e + 1] = vy * l;
        u[e + 2] = vz * l;
      } else {
        transport(u, e - 3, t, e - 3, t, e, q);
        u[e] = q[0];
        u[e + 1] = q[1];
        u[e + 2] = q[2];
      }
      // radial direction, spun by the laid-in twist
      const cy = x[e + 1];
      const cz = x[e + 2];
      const dot = cy * t[e + 1] + cz * t[e + 2];
      let rx = -dot * t[e];
      let ry = cy - dot * t[e + 1];
      let rz = cz - dot * t[e + 2];
      const l = 1 / sqrt(rx * rx + ry * ry + rz * rz + 1e-12);
      rx *= l;
      ry *= l;
      rz *= l;
      const c = rx * u[e] + ry * u[e + 1] + rz * u[e + 2];
      const b0 = t[e + 1] * u[e + 2] - t[e + 2] * u[e + 1];
      const b1 = t[e + 2] * u[e] - t[e] * u[e + 2];
      const b2 = t[e] * u[e + 1] - t[e + 1] * u[e];
      const s = rx * b0 + ry * b1 + rz * b2;
      const spun = (2 * PI * p.spin * this.laidIndex(rope, i)) / rope.K;
      let angle = atan2(s, c) + spun;
      if (i > 0) {
        const previous = theta[o + i - 1];
        angle += 2 * PI * Math.round((previous - angle) / (2 * PI));
      }
      theta[o + i] = angle;
    }
    for (let i = max(1, from); i < stride - 1; i++) this.refTwist[o + i] = this.referenceTwist(o + i, 0);
  }

  /** Signed angle from u on edge i - 1, carried over to edge i, to u on edge i */
  private referenceTwist(vertex: number, previous: number) {
    const { u, t } = this;
    const e1 = vertex * 3;
    const e0 = e1 - 3;
    const q = scratch;
    transport(u, e0, t, e0, t, e1, q);
    const c = q[0] * u[e1] + q[1] * u[e1 + 1] + q[2] * u[e1 + 2];
    const bx = q[1] * u[e1 + 2] - q[2] * u[e1 + 1];
    const by = q[2] * u[e1] - q[0] * u[e1 + 2];
    const bz = q[0] * u[e1 + 1] - q[1] * u[e1];
    let angle = atan2(bx * t[e1] + by * t[e1 + 1] + bz * t[e1 + 2], c);
    angle += 2 * PI * Math.round((previous - angle) / (2 * PI));
    return angle;
  }

  /** Twist at a vertex: the frames' angle difference plus the reference's own twist */
  twistAt(vertex: number) {
    return this.theta[vertex] - this.theta[vertex - 1] + this.refTwist[vertex];
  }

  private updateHeads() {
    const { ropes, h0, head, lo, hi, p } = this;
    const phase = (this.step % this.stepsPerLoop) / this.stepsPerLoop;
    for (const rope of ropes) {
      const h = h0 + headProgress(rope, phase);
      head[rope.index] = h;
      lo[rope.index] = max(2, floor(h) - p.window);
      hi[rope.index] = floor(h) - p.lag;
    }
  }

  private updateRest() {
    const { ropes, stride, lo, hi, head, rest, laid, w, p } = this;
    const warm = this.warm;
    w.fill(0);
    for (const rope of ropes) {
      const o = rope.index * stride;
      const h = head[rope.index];
      const shrink = rope.shrink - 1;
      for (let i = lo[rope.index] - 1; i <= hi[rope.index] + 1; i++) {
        rest[o + i] = laid[o + i] * (1 + shrink * warm * smooth01(p.shrinkFrom, p.shrinkTo, h - i));
      }
      for (let i = lo[rope.index]; i <= hi[rope.index]; i++) w[o + i] = 1;
    }
  }

  private accumulateForces() {
    const { ropes, stride, lo, hi, x, force, rest, p } = this;
    const B = p.bend;
    const T = p.twist;
    for (const rope of ropes) {
      const o = rope.index * stride;
      const first = lo[rope.index];
      const last = hi[rope.index];
      force.fill(0, (o + first - 2) * 3, (o + last + 3) * 3);
      for (let i = first - 1; i <= last + 1; i++) {
        const g = (o + i) * 3;
        const e0x = x[g] - x[g - 3];
        const e0y = x[g + 1] - x[g - 2];
        const e0z = x[g + 2] - x[g - 1];
        const e1x = x[g + 3] - x[g];
        const e1y = x[g + 4] - x[g + 1];
        const e1z = x[g + 5] - x[g + 2];
        const l0 = rest[o + i - 1];
        const l1 = rest[o + i];
        // 2 tan(φ/2) runs away as an edge folds back on itself: held at about 150°. By the edges'
        // actual lengths, the same as rest on the inextensible rod, or a contact that stretches
        // an edge inflates its curvature past the hold
        const lengths = sqrt((e0x * e0x + e0y * e0y + e0z * e0z) * (e1x * e1x + e1y * e1y + e1z * e1z));
        const D = max(lengths + e0x * e1x + e0y * e1y + e0z * e1z, 0.15 * lengths);
        const s = 2 / D;
        const kx = s * (e0y * e1z - e0z * e1y);
        const ky = s * (e0z * e1x - e0x * e1z);
        const kz = s * (e0x * e1y - e0y * e1x);
        const kk = kx * kx + ky * ky + kz * kz;
        const bl = (2 * B) / (l0 + l1) / D;
        // Bergou eq. for the gradient of the curvature binormal, contracted with itself
        let fax = -bl * (2 * (ky * e1z - kz * e1y) + e1x * kk);
        let fay = -bl * (2 * (kz * e1x - kx * e1z) + e1y * kk);
        let faz = -bl * (2 * (kx * e1y - ky * e1x) + e1z * kk);
        let fbx = -bl * (2 * (ky * e0z - kz * e0y) - e0x * kk);
        let fby = -bl * (2 * (kz * e0x - kx * e0z) - e0y * kk);
        let fbz = -bl * (2 * (kx * e0y - ky * e0x) - e0z * kk);
        if (T !== 0) {
          const m = this.twistAt(o + i);
          const c = (2 * T * m) / (l0 + l1);
          const c0 = c / (2 * l0);
          const c1 = c / (2 * l1);
          fax += c0 * kx;
          fay += c0 * ky;
          faz += c0 * kz;
          fbx -= c1 * kx;
          fby -= c1 * ky;
          fbz -= c1 * kz;
        }
        force[g - 3] += fax;
        force[g - 2] += fay;
        force[g - 1] += faz;
        force[g + 3] += fbx;
        force[g + 4] += fby;
        force[g + 5] += fbz;
        force[g] -= fax + fbx;
        force[g + 1] -= fay + fby;
        force[g + 2] -= faz + fbz;
      }
    }
  }

  private integrate() {
    const { ropes, stride, lo, hi, x, v, xPrev, force, dt, p, head, laid } = this;
    const fade = Math.exp(-p.drag * dt);
    const pull = p.pull * this.warm;
    const { target, targetNext, targetMix, feedback: k, feedbackDamp: kd } = this;
    const rate = this.historyRate;
    for (const rope of ropes) {
      const o = rope.index * stride;
      const h = head[rope.index];
      for (let i = lo[rope.index]; i <= hi[rope.index]; i++) {
        const g = (o + i) * 3;
        // by laid length: a rope that shrinks keeps its mass
        const m = p.density * 0.5 * (laid[o + i - 1] + laid[o + i]);
        let ax = force[g] / m;
        let ay = force[g + 1] / m;
        let az = force[g + 2] / m;
        if (pull) {
          const r = sqrt(x[g + 1] ** 2 + x[g + 2] ** 2) + 1e-6;
          const s = (pull * smooth01(p.shrinkFrom, p.shrinkTo, h - i)) / r;
          ay -= s * x[g + 1];
          az -= s * x[g + 2];
        }
        if (k && target && targetNext) {
          const tx = target[g] + (targetNext[g] - target[g]) * targetMix;
          const ty = target[g + 1] + (targetNext[g + 1] - target[g + 1]) * targetMix;
          const tz = target[g + 2] + (targetNext[g + 2] - target[g + 2]) * targetMix;
          ax += k * (tx - x[g]) + kd * ((targetNext[g] - target[g]) * rate - v[g]);
          ay += k * (ty - x[g + 1]) + kd * ((targetNext[g + 1] - target[g + 1]) * rate - v[g + 1]);
          az += k * (tz - x[g + 2]) + kd * ((targetNext[g + 2] - target[g + 2]) * rate - v[g + 2]);
        }
        const vx = (v[g] + ax * dt) * fade;
        const vy = (v[g + 1] + ay * dt) * fade;
        const vz = (v[g + 2] + az * dt) * fade;
        const speed = vx * vx + vy * vy + vz * vz;
        const scale = speed > SPEED_LIMIT * SPEED_LIMIT ? SPEED_LIMIT / sqrt(speed) : 1;
        v[g] = vx * scale;
        v[g + 1] = vy * scale;
        v[g + 2] = vz * scale;
      }
    }
    xPrev.set(x);
    for (const rope of ropes) {
      const o = rope.index * stride;
      for (let i = lo[rope.index]; i <= hi[rope.index]; i++) {
        const g = (o + i) * 3;
        x[g] += v[g] * dt;
        x[g + 1] += v[g + 1] * dt;
        x[g + 2] += v[g + 2] * dt;
      }
    }
  }

  /** Goldenthal's fast projection: Newton steps on the edge lengths, one tridiagonal solve each */
  project(sweeps = 3, tolerance = 1e-3) {
    const { ropes, stride, lo, hi, x, rest, a, b, c, d, p } = this;
    for (const rope of ropes) {
      const o = rope.index * stride;
      const first = lo[rope.index] - 1; // first edge: frozen node to first free node
      const last = hi[rope.index]; // last edge: last free node to the pinned one
      const n = last - first + 1;
      for (let sweep = 0; sweep < sweeps; sweep++) {
        let worst = 0;
        for (let k = 0; k < n; k++) {
          const i = first + k;
          const g = (o + i) * 3;
          const ex = x[g + 3] - x[g];
          const ey = x[g + 4] - x[g + 1];
          const ez = x[g + 5] - x[g + 2];
          const ee = ex * ex + ey * ey + ez * ez;
          const l = rest[o + i];
          const C = ee / l - l;
          worst = max(worst, Math.abs(C) / l);
          // inverse masses: both ends of the span are pinned
          const wa = k === 0 ? 0 : 1;
          const wb = k === n - 1 ? 0 : 1;
          // a little compliance: a rope asked to be shorter than the gap between its pins has no
          // solution, and without this Newton answers with an enormous step
          b[k] = (4 * ee * (wa + wb)) / (l * l) + 1e-3;
          d[k] = C;
          if (k + 1 < n) {
            const fx = x[g + 6] - x[g + 3];
            const fy = x[g + 7] - x[g + 4];
            const fz = x[g + 8] - x[g + 5];
            const off = (-4 * (ex * fx + ey * fy + ez * fz)) / (l * rest[o + i + 1]);
            a[k + 1] = off;
            c[k] = off;
          }
        }
        if (worst < tolerance) break;
        // Thomas
        for (let k = 1; k < n; k++) {
          const m = a[k] / b[k - 1];
          b[k] -= m * c[k - 1];
          d[k] -= m * d[k - 1];
        }
        d[n - 1] /= b[n - 1];
        for (let k = n - 2; k >= 0; k--) d[k] = (d[k] - c[k] * d[k + 1]) / b[k];
        // dx = -M⁻¹ Jᵀ λ, with J rows ±2e/l
        for (let k = 1; k < n; k++) {
          // node first + k sits between edges k - 1 and k
          const i = first + k;
          const g = (o + i) * 3;
          const p0 = (2 * d[k - 1]) / rest[o + i - 1];
          const p1 = (2 * d[k]) / rest[o + i];
          const ex = x[g] - x[g - 3];
          const ey = x[g + 1] - x[g - 2];
          const ez = x[g + 2] - x[g - 1];
          const fx = x[g + 3] - x[g];
          const fy = x[g + 4] - x[g + 1];
          const fz = x[g + 5] - x[g + 2];
          this.c[k - 1] = p0 * ex - p1 * fx;
          this.a[k - 1] = p0 * ey - p1 * fy;
          this.b[k - 1] = p0 * ez - p1 * fz;
        }
        let longest = 0;
        for (let k = 1; k < n; k++) longest = max(longest, c[k - 1] ** 2 + a[k - 1] ** 2 + b[k - 1] ** 2);
        const scale = min(1, (p.separate * this.dt) / (sqrt(longest) + 1e-12));
        for (let k = 1; k < n; k++) {
          const g = (o + first + k) * 3;
          x[g] -= c[k - 1] * scale;
          x[g + 1] -= a[k - 1] * scale;
          x[g + 2] -= b[k - 1] * scale;
        }
      }
    }
  }

  private broadphase() {
    const { ropes, stride, lo, hi, x, p, buckets, next, cell } = this;
    const reach = 2 * p.radius + p.spacing * 1.2 + 0.06;
    const size = reach;
    const mask = buckets.length - 1;
    buckets.fill(-1);
    const hash = (a: number, b: number, c: number) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & mask;
    for (const rope of ropes) {
      const o = rope.index * stride;
      for (let i = max(0, lo[rope.index] - 6); i <= hi[rope.index] + 3; i++) {
        const e = o + i;
        const g = e * 3;
        const a = floor((x[g] + x[g + 3]) * 0.5 / size);
        const b = floor((x[g + 1] + x[g + 4]) * 0.5 / size);
        const c = floor((x[g + 2] + x[g + 5]) * 0.5 / size);
        cell[g] = a;
        cell[g + 1] = b;
        cell[g + 2] = c;
        const key = hash(a, b, c);
        next[e] = buckets[key];
        buckets[key] = e;
      }
    }
    let count = 0;
    const reach2 = reach * reach;
    const skip = Math.ceil((2 * p.radius) / p.spacing) + 1;
    for (const rope of ropes) {
      const o = rope.index * stride;
      for (let i = max(0, lo[rope.index] - 6); i <= hi[rope.index] + 3; i++) {
        const e = o + i;
        const g = e * 3;
        const mx = x[g] + x[g + 3];
        const my = x[g + 1] + x[g + 4];
        const mz = x[g + 2] + x[g + 5];
        const ca = cell[g];
        const cb = cell[g + 1];
        const cc = cell[g + 2];
        for (let da = -1; da <= 1; da++)
          for (let db = -1; db <= 1; db++)
            for (let dc = -1; dc <= 1; dc++) {
              const A = ca + da;
              const Bc = cb + db;
              const Cc = cc + dc;
              for (let f = buckets[hash(A, Bc, Cc)]; f >= 0; f = next[f]) {
                if (f <= e) continue;
                const q = f * 3;
                if (cell[q] !== A || cell[q + 1] !== Bc || cell[q + 2] !== Cc) continue;
                if (f - e <= skip && floor(f / stride) === floor(e / stride)) continue;
                const dx = (x[q] + x[q + 3] - mx) * 0.5;
                const dy = (x[q + 1] + x[q + 4] - my) * 0.5;
                const dz = (x[q + 2] + x[q + 5] - mz) * 0.5;
                if (dx * dx + dy * dy + dz * dz > reach2) continue;
                if (count * 2 + 2 > this.pairs.length) {
                  const bigger = new Int32Array(this.pairs.length * 2);
                  bigger.set(this.pairs);
                  this.pairs = bigger;
                }
                this.pairs[count * 2] = e;
                this.pairs[count * 2 + 1] = f;
                count++;
              }
            }
      }
    }
    this.pairCount = count;
  }

  private collide() {
    const { pairs, pairCount, x, xPrev, w, p } = this;
    const reach = 2 * p.radius;
    const reach2 = reach * reach;
    const near = (reach + p.spacing * 1.1) ** 2;
    const mu = p.friction;
    const push = p.separate * this.dt;
    let touching = 0;
    for (let n = 0; n < pairCount; n++) {
      const e = pairs[n * 2];
      const f = pairs[n * 2 + 1];
      const A = e * 3;
      const C = f * 3;
      const ux = x[A + 3] - x[A];
      const uy = x[A + 4] - x[A + 1];
      const uz = x[A + 5] - x[A + 2];
      const vx = x[C + 3] - x[C];
      const vy = x[C + 4] - x[C + 1];
      const vz = x[C + 5] - x[C + 2];
      const rx = x[A] - x[C];
      const ry = x[A + 1] - x[C + 1];
      const rz = x[A + 2] - x[C + 2];
      const mx = rx + (ux - vx) * 0.5;
      const my = ry + (uy - vy) * 0.5;
      const mz = rz + (uz - vz) * 0.5;
      if (mx * mx + my * my + mz * mz > near) continue;
      // closest points of two segments (Ericson)
      const a = ux * ux + uy * uy + uz * uz;
      const b = ux * vx + uy * vy + uz * vz;
      const c = vx * vx + vy * vy + vz * vz;
      const d = ux * rx + uy * ry + uz * rz;
      const q = vx * rx + vy * ry + vz * rz;
      const den = a * c - b * b;
      let s = den > 1e-12 ? min(1, max(0, (b * q - c * d) / den)) : 0.5;
      let t = (b * s + q) / c;
      if (t < 0) {
        t = 0;
        s = min(1, max(0, -d / a));
      } else if (t > 1) {
        t = 1;
        s = min(1, max(0, (b - d) / a));
      }
      const dx = rx + ux * s - vx * t;
      const dy = ry + uy * s - vy * t;
      const dz = rz + uz * s - vz * t;
      const dd = dx * dx + dy * dy + dz * dz;
      if (dd >= reach2 || dd < 1e-14) continue;
      touching++;
      const dist = sqrt(dd);
      // capped, or a deep overlap turns into a huge velocity in one substep
      const pen = min(reach - dist, push);
      const nx = dx / dist;
      const ny = dy / dist;
      const nz = dz / dist;
      const w0 = w[e] * (1 - s);
      const w1 = w[e + 1] * s;
      const w2 = w[f] * (1 - t);
      const w3 = w[f + 1] * t;
      const sum = w0 * (1 - s) + w1 * s + w2 * (1 - t) + w3 * t;
      if (sum < 1e-9) continue;
      // friction: undo sideways slip this substep, up to what the push allows
      const pxr =
        (x[A] - xPrev[A]) * (1 - s) + (x[A + 3] - xPrev[A + 3]) * s - (x[C] - xPrev[C]) * (1 - t) - (x[C + 3] - xPrev[C + 3]) * t;
      const pyr =
        (x[A + 1] - xPrev[A + 1]) * (1 - s) + (x[A + 4] - xPrev[A + 4]) * s - (x[C + 1] - xPrev[C + 1]) * (1 - t) - (x[C + 4] - xPrev[C + 4]) * t;
      const pzr =
        (x[A + 2] - xPrev[A + 2]) * (1 - s) + (x[A + 5] - xPrev[A + 5]) * s - (x[C + 2] - xPrev[C + 2]) * (1 - t) - (x[C + 5] - xPrev[C + 5]) * t;
      const along = pxr * nx + pyr * ny + pzr * nz;
      let tx = pxr - along * nx;
      let ty = pyr - along * ny;
      let tz = pzr - along * nz;
      const slip = sqrt(tx * tx + ty * ty + tz * tz);
      const stick = slip > 1e-12 ? min(1, (mu * pen) / slip) : 0;
      tx *= stick;
      ty *= stick;
      tz *= stick;
      // floored: a contact right beside a pinned node leaves a tiny weight on the free one, and
      // the plain solve would throw that node pen / weight
      const lambda = 1 / max(sum, 0.25);
      const ix = (pen * nx - tx) * lambda;
      const iy = (pen * ny - ty) * lambda;
      const iz = (pen * nz - tz) * lambda;
      x[A] += ix * w0;
      x[A + 1] += iy * w0;
      x[A + 2] += iz * w0;
      x[A + 3] += ix * w1;
      x[A + 4] += iy * w1;
      x[A + 5] += iz * w1;
      x[C] -= ix * w2;
      x[C + 1] -= iy * w2;
      x[C + 2] -= iz * w2;
      x[C + 3] -= ix * w3;
      x[C + 4] -= iy * w3;
      x[C + 5] -= iz * w3;
    }
    return touching;
  }

  private settleVelocity() {
    const { ropes, stride, lo, hi, x, xPrev, v, dt, p } = this;
    const inv = 1 / dt;
    const limit2 = SPEED_LIMIT * SPEED_LIMIT;
    for (const rope of ropes) {
      const o = rope.index * stride;
      const first = lo[rope.index];
      const last = hi[rope.index];
      for (let i = first; i <= last; i++) {
        const g = (o + i) * 3;
        const vx = (x[g] - xPrev[g]) * inv;
        const vy = (x[g + 1] - xPrev[g + 1]) * inv;
        const vz = (x[g + 2] - xPrev[g + 2]) * inv;
        const speed = vx * vx + vy * vy + vz * vz;
        const scale = speed > limit2 ? sqrt(limit2 / speed) : 1;
        v[g] = vx * scale;
        v[g + 1] = vy * scale;
        v[g + 2] = vz * scale;
      }
      // fourth difference: takes out the grid-scale wiggle that explicit bending leaves behind,
      // and barely touches anything longer than a few nodes
      const e = p.smooth;
      if (e > 0) {
        for (let c = 0; c < 3; c++) {
          let m2 = 0;
          let m1 = 0;
          for (let i = first; i <= last; i++) {
            const g = (o + i) * 3 + c;
            const here = v[g];
            const a = i - 2 >= first ? m2 : 0;
            const b = i - 1 >= first ? m1 : 0;
            const d = i + 1 <= last ? v[g + 3] : 0;
            const f = i + 2 <= last ? v[g + 6] : 0;
            v[g] = here - e * (a - 4 * b + 6 * here - 4 * d + f);
            m2 = m1;
            m1 = here;
          }
        }
      }
    }
  }

  /** Bishop frames follow the tangents through time, then θ settles (quasistatically, as in the paper) */
  private updateFrames() {
    const { ropes, stride, lo, hi, x, t, u, refTwist, theta, rest, a, b, c, d, p } = this;
    const q = scratch;
    const T = p.twist;
    for (const rope of ropes) {
      const o = rope.index * stride;
      const first = lo[rope.index] - 1;
      const last = hi[rope.index];
      for (let i = first; i <= last; i++) {
        const e = (o + i) * 3;
        const ex = x[e + 3] - x[e];
        const ey = x[e + 4] - x[e + 1];
        const ez = x[e + 5] - x[e + 2];
        const l = 1 / sqrt(ex * ex + ey * ey + ez * ez);
        q2[0] = ex * l;
        q2[1] = ey * l;
        q2[2] = ez * l;
        transport(u, e, t, e, q2, 0, q);
        const dot = q[0] * q2[0] + q[1] * q2[1] + q[2] * q2[2];
        const sx = q[0] - dot * q2[0];
        const sy = q[1] - dot * q2[1];
        const sz = q[2] - dot * q2[2];
        const m = 1 / sqrt(sx * sx + sy * sy + sz * sz);
        u[e] = sx * m;
        u[e + 1] = sy * m;
        u[e + 2] = sz * m;
        t[e] = q2[0];
        t[e + 1] = q2[1];
        t[e + 2] = q2[2];
      }
      for (let i = first; i <= last + 1; i++) refTwist[o + i] = this.referenceTwist(o + i, refTwist[o + i]);
      if (T === 0) continue;
      // θ minimises twist energy with the edges either side held: one tridiagonal solve
      const from = first;
      const n = last - from + 1;
      for (let k = 0; k < n; k++) {
        const i = from + k;
        const ci = 1 / (rest[o + i - 1] + rest[o + i]);
        const cj = 1 / (rest[o + i] + rest[o + i + 1]);
        b[k] = ci + cj;
        a[k] = -ci;
        c[k] = -cj;
        d[k] = -ci * refTwist[o + i] + cj * refTwist[o + i + 1];
        if (k === 0) d[k] += ci * theta[o + i - 1];
        if (k === n - 1) d[k] += cj * theta[o + i + 1];
      }
      for (let k = 1; k < n; k++) {
        const m = a[k] / b[k - 1];
        b[k] -= m * c[k - 1];
        d[k] -= m * d[k - 1];
      }
      theta[o + from + n - 1] = d[n - 1] / b[n - 1];
      for (let k = n - 2; k >= 0; k--) theta[o + from + k] = (d[k] - c[k] * theta[o + from + k + 1]) / b[k];
    }
  }

  /** One period is over: everything moves back K nodes and one pitch */
  private rebase() {
    const { ropes, stride, x, v, xPrev, laid, rest, t, u, theta, refTwist, p } = this;
    for (const rope of ropes) {
      const o = rope.index * stride;
      const K = rope.K;
      const count = stride - K;
      x.copyWithin(o * 3, (o + K) * 3, (o + stride) * 3);
      v.copyWithin(o * 3, (o + K) * 3, (o + stride) * 3);
      t.copyWithin(o * 3, (o + K) * 3, (o + stride) * 3);
      u.copyWithin(o * 3, (o + K) * 3, (o + stride) * 3);
      laid.copyWithin(o, o + K, o + stride);
      rest.copyWithin(o, o + K, o + stride);
      theta.copyWithin(o, o + K, o + stride);
      refTwist.copyWithin(o, o + K, o + stride);
      v.fill(0, (o + count) * 3, (o + stride) * 3);
      for (let i = 0; i < count; i++) x[(o + i) * 3] -= p.pitch;
      // new rope ahead of the head continues the last director. From count - 1, because the last
      // slot of the arrays holds no edge and has just been shifted there
      this.lay(rope, count - 1);
    }
    xPrev.set(x);
  }

  /** Advances one substep */
  advance() {
    const { p } = this;
    this.warm = smooth01(0, this.warmSeconds, this.time);
    this.updateHeads();
    this.updateRest();
    if (this.feedback && this.history.length) this.pickTarget();
    this.accumulateForces();
    this.integrate();
    this.project(3);
    if (this.step % p.broadEvery === 0) this.broadphase();
    this.contacts = this.collide();
    this.collide();
    this.project(2);
    this.settleVelocity();
    this.updateFrames();
    this.time += this.dt;
    this.step++;
    if (this.step % this.stepsPerLoop === 0) {
      this.rebase();
      this.updateHeads();
    }
  }

  private pickTarget() {
    const frames = this.history.length;
    const inLoop = (this.step % this.stepsPerLoop) / this.stepsPerLoop;
    const at = inLoop * frames;
    const f = floor(at);
    // frame 0 of the history is already shifted K nodes and a pitch back, so the last interval
    // can't aim at it: that would kick every node once a loop. It runs on from the two before
    const last = f >= frames - 1;
    this.target = this.history[last ? frames - 2 : f];
    this.targetNext = this.history[last ? frames - 1 : f + 1];
    this.targetMix = last ? 1 + at - f : at - f;
  }

  /** Material director per edge, written as a unit vector */
  director(edge: number, out: Float64Array | number[], at: number) {
    const { u, t, theta } = this;
    const e = edge * 3;
    const c = cos(theta[edge]);
    const s = sin(theta[edge]);
    const bx = t[e + 1] * u[e + 2] - t[e + 2] * u[e + 1];
    const by = t[e + 2] * u[e] - t[e] * u[e + 2];
    const bz = t[e] * u[e + 1] - t[e + 1] * u[e];
    out[at] = c * u[e] + s * bx;
    out[at + 1] = c * u[e + 1] + s * by;
    out[at + 2] = c * u[e + 2] + s * bz;
  }
}

const scratch = [0, 0, 0];
const q2 = [0, 0, 0];

/** Carries the vector at `v[vi]` from unit tangent `a[ai]` to `b[bi]` by the shortest rotation */
function transport(v: ArrayLike<number>, vi: number, a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number, out: number[]) {
  const ax = a[ai];
  const ay = a[ai + 1];
  const az = a[ai + 2];
  const bx = b[bi];
  const by = b[bi + 1];
  const bz = b[bi + 2];
  const wx = ay * bz - az * by;
  const wy = az * bx - ax * bz;
  const wz = ax * by - ay * bx;
  const c = 1 / (1 + ax * bx + ay * by + az * bz);
  const vx = v[vi];
  const vy = v[vi + 1];
  const vz = v[vi + 2];
  const px = wy * vz - wz * vy;
  const py = wz * vx - wx * vz;
  const pz = wx * vy - wy * vx;
  out[0] = vx + px + (wy * pz - wz * py) * c;
  out[1] = vy + py + (wz * px - wx * pz) * c;
  out[2] = vz + pz + (wx * py - wy * px) * c;
}
