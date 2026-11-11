// Balls in the plane of the sheets, knocked about by the dancer and the mouse.
// The dancer is only known as a distance map read back from the GPU a frame or two late. Its gradient
// is the way out of him, and how fast it falls at a point is how fast his outline is coming at it.

export type BallSettings = {
  count: number;
  size: number;
  spread: number;
  gravity: number;
  drag: number;
  bounce: number;
  /** how hard a moving limb throws a ball, against its own speed */
  kick: number;
  seed: number;
};

export const READBACK = 256;

type Field = { data: Float32Array; time: number };

export class Balls {
  x: number[] = [];
  y: number[] = [];
  vx: number[] = [];
  vy: number[] = [];
  r: number[] = [];
  settings: BallSettings;
  /** the opening's half size */
  bounds = 1;
  now: Field | null = null;
  before: Field | null = null;

  constructor(settings: BallSettings) {
    this.settings = settings;
    this.reset();
  }

  reset() {
    let s = this.settings.seed * 2654435761;
    const rand = () => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    const { count, size, spread } = this.settings;
    this.x = []; this.y = []; this.vx = []; this.vy = []; this.r = [];
    for (let i = 0; i < count; i++) {
      // round the edge of the frame, out of the dancer's way
      const a = rand() * Math.PI * 2;
      this.x.push(Math.cos(a) * 0.72);
      this.y.push(Math.sin(a) * 0.72);
      this.vx.push(0);
      this.vy.push(0);
      this.r.push(size * (1 + spread * (rand() * 2 - 1)));
    }
  }

  /** a new map from the GPU */
  receive(data: Float32Array, time: number) {
    // two reads in flight can land out of order
    if (this.now && time <= this.now.time) return;
    this.before = this.now;
    this.now = { data, time };
  }

  sample(field: Float32Array, x: number, y: number) {
    const n = READBACK;
    const u = Math.min(Math.max((x * 0.5 + 0.5) * n - 0.5, 0), n - 1.001);
    const v = Math.min(Math.max((0.5 - y * 0.5) * n - 0.5, 0), n - 1.001);
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const a = field[j * n + i], b = field[j * n + i + 1], c = field[(j + 1) * n + i], d = field[(j + 1) * n + i + 1];
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }

  /**
   * One step. `reach` is how far the dancer's cut reaches past his outline, so balls touch the cut.
   * The pointer, when there is one, shoves balls like a finger.
   */
  step(dt: number, reach: number, pointer: { x: number; y: number; vx: number; vy: number; r: number } | null) {
    const s = this.settings;
    const n = this.x.length;
    const e = 2 / READBACK;
    for (let i = 0; i < n; i++) {
      this.vy[i] -= s.gravity * dt;
      const damp = Math.exp(-s.drag * dt);
      this.vx[i] *= damp;
      this.vy[i] *= damp;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }

    // the dancer
    const now = this.now, before = this.before;
    if (now) {
      for (let i = 0; i < n; i++) {
        const contact = this.r[i] + reach;
        const d = this.sample(now.data, this.x[i], this.y[i]);
        if (d >= contact) continue;
        let gx = this.sample(now.data, this.x[i] + e, this.y[i]) - this.sample(now.data, this.x[i] - e, this.y[i]);
        let gy = this.sample(now.data, this.x[i], this.y[i] + e) - this.sample(now.data, this.x[i], this.y[i] - e);
        const gl = Math.hypot(gx, gy);
        if (gl < 1e-9) {
          // deep inside, where the map is flat: out the way it came
          gx = this.vx[i] || 1; gy = this.vy[i];
        }
        const l = Math.hypot(gx, gy) || 1;
        gx /= l; gy /= l;
        this.x[i] += gx * (contact - d);
        this.y[i] += gy * (contact - d);
        // the outline's own speed here, from how fast the distance fell
        let surface = 0;
        if (before && now.time > before.time) {
          const was = this.sample(before.data, this.x[i], this.y[i]);
          const is = this.sample(now.data, this.x[i], this.y[i]);
          surface = Math.max((was - is) / (now.time - before.time), 0);
        }
        const vn = this.vx[i] * gx + this.vy[i] * gy;
        const want = Math.max(surface * s.kick, -vn * s.bounce);
        if (vn < want) {
          this.vx[i] += gx * (want - vn);
          this.vy[i] += gy * (want - vn);
        }
      }
    }

    // the pointer
    if (pointer) {
      for (let i = 0; i < n; i++) {
        const dx = this.x[i] - pointer.x, dy = this.y[i] - pointer.y;
        const d = Math.hypot(dx, dy);
        const contact = this.r[i] + pointer.r;
        if (d >= contact || d < 1e-9) continue;
        const nx = dx / d, ny = dy / d;
        this.x[i] += nx * (contact - d);
        this.y[i] += ny * (contact - d);
        const push = pointer.vx * nx + pointer.vy * ny;
        const vn = this.vx[i] * nx + this.vy[i] * ny;
        if (vn < push) {
          this.vx[i] += nx * (push - vn);
          this.vy[i] += ny * (push - vn);
        }
      }
    }

    // each other
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = this.x[j] - this.x[i], dy = this.y[j] - this.y[i];
        const d = Math.hypot(dx, dy);
        const contact = this.r[i] + this.r[j] + reach;
        if (d >= contact || d < 1e-9) continue;
        const nx = dx / d, ny = dy / d;
        const mi = this.r[i] ** 2, mj = this.r[j] ** 2;
        const share = mj / (mi + mj);
        const over = contact - d;
        this.x[i] -= nx * over * share; this.y[i] -= ny * over * share;
        this.x[j] += nx * over * (1 - share); this.y[j] += ny * over * (1 - share);
        const rel = (this.vx[j] - this.vx[i]) * nx + (this.vy[j] - this.vy[i]) * ny;
        if (rel >= 0) continue;
        const impulse = (-(1 + s.bounce) * rel) / (1 / mi + 1 / mj);
        this.vx[i] -= (impulse / mi) * nx; this.vy[i] -= (impulse / mi) * ny;
        this.vx[j] += (impulse / mj) * nx; this.vy[j] += (impulse / mj) * ny;
      }

    // the frame
    for (let i = 0; i < n; i++) {
      const lim = this.bounds - this.r[i] - reach;
      if (this.x[i] > lim) { this.x[i] = lim; this.vx[i] = -Math.abs(this.vx[i]) * s.bounce; }
      if (this.x[i] < -lim) { this.x[i] = -lim; this.vx[i] = Math.abs(this.vx[i]) * s.bounce; }
      if (this.y[i] > lim) { this.y[i] = lim; this.vy[i] = -Math.abs(this.vy[i]) * s.bounce; }
      if (this.y[i] < -lim) { this.y[i] = -lim; this.vy[i] = Math.abs(this.vy[i]) * s.bounce; }
    }
  }
}
