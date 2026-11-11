// Soft bubbles in a box: Durian's bubble model with a volume term.
// Each bubble is a sphere that overlaps its neighbours, and is drawn as the part of it on its own side of
// the radical plane to each one, which is what two pressed balloons look like where they touch.

export type FoamSettings = {
  count: number;
  /** half size of the solid block */
  box: [number, number, number];
  /** how far past the block the bubbles may reach, which is what opens holes in its faces */
  reach: number;
  /** total bubble volume against the block's volume */
  fill: number;
  /** spread of sizes, 0 for all the same */
  spread: number;
  /** how much each bubble swells and shrinks over a loop */
  breathe: number;
  /** how strongly a squashed bubble swells back into free space */
  pressure: number;
  stiffness: number;
  damping: number;
  gravity: number;
  seed: number;
};

export const MAX_BUBBLES = 64;
export const MAX_PLANES = 15;

export type Bubble = {
  x: Float64Array; // position
  v: Float64Array; // velocity
  /** rest radius, and the phase of its breath */
  r0: number;
  phase: number;
  /** radius now, swollen by pressure */
  r: number;
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

const sphereVolume = (r: number) => (4 / 3) * Math.PI * r * r * r;
/** volume of a sphere of radius r beyond a plane at distance a from its centre */
const capVolume = (r: number, a: number) => {
  if (a >= r) return 0;
  if (a <= -r) return sphereVolume(r);
  const h = r - a;
  return (Math.PI * h * h * (3 * r - h)) / 3;
};

export class Foam {
  bubbles: Bubble[] = [];
  time = 0;
  settings: FoamSettings;
  constructor(settings: FoamSettings) {
    this.settings = settings;
    this.reset();
  }

  /** the container the bubbles live in: the block plus reach */
  get walls() {
    const { box, reach } = this.settings;
    return box.map((b) => b + reach) as [number, number, number];
  }

  reset() {
    const s = this.settings;
    const rand = random(s.seed * 7919 + 13);
    const [bx, by, bz] = s.box;
    const volume = 8 * bx * by * bz;
    const sizes = Array.from({ length: s.count }, () => 1 + s.spread * (rand() * 2 - 1));
    const total = sizes.reduce((a, k) => a + sphereVolume(k), 0);
    const scale = Math.cbrt((s.fill * volume) / total);
    const [wx, wy, wz] = this.walls;
    this.bubbles = sizes.map((k) => {
      const r0 = k * scale;
      return {
        x: Float64Array.of((rand() * 2 - 1) * wx * 0.8, (rand() * 2 - 1) * wy * 0.8, (rand() * 2 - 1) * wz * 0.8),
        v: new Float64Array(3),
        r0,
        phase: rand(),
        r: r0,
      };
    });
    this.time = 0;
  }

  /** the rest radius at a point in the loop, 0..1 */
  restRadius(b: Bubble, playhead: number) {
    return b.r0 * (1 + this.settings.breathe * Math.sin(2 * Math.PI * (playhead + b.phase)));
  }

  step(dt: number, playhead: number) {
    const s = this.settings;
    const bs = this.bubbles;
    const n = bs.length;
    const walls = this.walls;
    const force = new Float64Array(n * 3);

    for (let i = 0; i < n; i++) {
      const a = bs[i];
      for (let j = i + 1; j < n; j++) {
        const b = bs[j];
        const dx = b.x[0] - a.x[0], dy = b.x[1] - a.x[1], dz = b.x[2] - a.x[2];
        const d = Math.hypot(dx, dy, dz) || 1e-9;
        const overlap = a.r + b.r - d;
        if (overlap <= 0) continue;
        const nx = dx / d, ny = dy / d, nz = dz / d;
        // a spring on overlap, scaled by the reduced radius so big and small bubbles feel alike
        const rr = (a.r * b.r) / (a.r + b.r);
        const rv = (b.v[0] - a.v[0]) * nx + (b.v[1] - a.v[1]) * ny + (b.v[2] - a.v[2]) * nz;
        const f = s.stiffness * overlap * rr - s.damping * rv * rr;
        force[i * 3] -= f * nx; force[i * 3 + 1] -= f * ny; force[i * 3 + 2] -= f * nz;
        force[j * 3] += f * nx; force[j * 3 + 1] += f * ny; force[j * 3 + 2] += f * nz;
      }
      // container walls, softly, like neighbours of infinite size
      for (let k = 0; k < 3; k++) {
        for (const side of [-1, 1]) {
          const overlap = a.x[k] * side + a.r - walls[k];
          if (overlap <= 0) continue;
          const rv = a.v[k] * side;
          force[i * 3 + k] -= side * (s.stiffness * overlap * a.r + s.damping * Math.max(rv, 0) * a.r);
        }
      }
    }

    for (let i = 0; i < n; i++) {
      const b = bs[i];
      const mass = b.r0 * b.r0 * b.r0;
      // a little drag on the whole bubble, against the air, so jostling settles
      for (let k = 0; k < 3; k++) {
        b.v[k] += ((force[i * 3 + k] - s.damping * 0.15 * b.v[k] * b.r) / mass) * dt;
      }
      b.v[1] -= s.gravity * dt;
      for (let k = 0; k < 3; k++) b.x[k] += b.v[k] * dt;
    }

    this.swell(playhead);
    this.time += dt;
  }

  /** squashed bubbles swell into free space, keeping some of their volume */
  swell(playhead: number) {
    const s = this.settings;
    const bs = this.bubbles;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      let lost = 0;
      for (let j = 0; j < bs.length; j++) {
        if (j === i) continue;
        const b = bs[j];
        const d = Math.hypot(b.x[0] - a.x[0], b.x[1] - a.x[1], b.x[2] - a.x[2]);
        if (d >= a.r + b.r) continue;
        lost += capVolume(a.r, radical(d, a.r, b.r));
      }
      const rest = this.restRadius(a, playhead);
      const want = sphereVolume(rest);
      const have = Math.max(sphereVolume(a.r) - lost, want * 0.2);
      const target = a.r * Math.cbrt(1 + s.pressure * (want / have - 1));
      // limited, so a bubble can't run away when it's crowded on every side
      a.r += (Math.min(Math.max(target, rest), rest * 1.6) - a.r) * 0.1;
    }
  }

  pack(out: Float32Array, neighbours: Uint32Array) {
    packBubbles(this.bubbles, out, neighbours);
  }
}

/**
 * Pack for the GPU: per bubble a vec4 of centre and radius, then up to MAX_PLANES planes as
 * (normal, offset) in the bubble's frame, with the neighbour's index in the w of a separate list.
 */
export function packBubbles(bs: Bubble[], out: Float32Array, neighbours: Uint32Array) {
  const stride = (1 + MAX_PLANES) * 4;
  const near: { j: number; a: number; n: number[]; d: number }[] = [];
  for (let i = 0; i < bs.length; i++) {
    const a = bs[i];
    near.length = 0;
    for (let j = 0; j < bs.length; j++) {
      if (j === i) continue;
      const b = bs[j];
      const dx = b.x[0] - a.x[0], dy = b.x[1] - a.x[1], dz = b.x[2] - a.x[2];
      const d = Math.hypot(dx, dy, dz);
      if (d >= a.r + b.r || d < 1e-6) continue;
      near.push({ j, a: radical(d, a.r, b.r), n: [dx / d, dy / d, dz / d], d });
    }
    // keep the planes that cut deepest, if there are more than fit
    near.sort((p, q) => p.a - q.a);
    const count = Math.min(near.length, MAX_PLANES);
    const o = i * stride;
    out[o] = a.x[0]; out[o + 1] = a.x[1]; out[o + 2] = a.x[2]; out[o + 3] = a.r;
    for (let k = 0; k < MAX_PLANES; k++) {
      const p = o + 4 + k * 4;
      if (k < count) {
        const q = near[k];
        out[p] = q.n[0]; out[p + 1] = q.n[1]; out[p + 2] = q.n[2]; out[p + 3] = q.a;
        neighbours[i * (MAX_PLANES + 1) + 1 + k] = q.j;
      } else {
        out[p] = 0; out[p + 1] = 0; out[p + 2] = 0; out[p + 3] = 1e3;
      }
    }
    neighbours[i * (MAX_PLANES + 1)] = count;
  }
}

/** distance from the first centre to the radical plane of two spheres d apart */
export function radical(d: number, r1: number, r2: number) {
  return (d * d + r1 * r1 - r2 * r2) / (2 * d);
}

/**
 * A uniform grid over the container listing, per cell, the bubbles that come within `margin` of it,
 * so a shader point only looks at a few bubbles.
 */
export class Grid {
  cells: Uint32Array<ArrayBuffer>;
  dims: [number, number, number];
  slots: number;
  constructor(dims: [number, number, number], slots: number) {
    this.dims = dims;
    this.slots = slots;
    this.cells = new Uint32Array(dims[0] * dims[1] * dims[2] * (slots + 1));
  }

  build(bubbles: Bubble[], lo: number[], hi: number[], margin: number) {
    const [gx, gy, gz] = this.dims;
    const size = [(hi[0] - lo[0]) / gx, (hi[1] - lo[1]) / gy, (hi[2] - lo[2]) / gz];
    this.cells.fill(0);
    let overflow = 0;
    bubbles.forEach((b, i) => {
      const reach = b.r + margin;
      const from = [0, 1, 2].map((k) => Math.max(0, Math.floor((b.x[k] - reach - lo[k]) / size[k])));
      const to = [0, 1, 2].map((k) => Math.min(this.dims[k] - 1, Math.floor((b.x[k] + reach - lo[k]) / size[k])));
      for (let z = from[2]; z <= to[2]; z++)
        for (let y = from[1]; y <= to[1]; y++)
          for (let x = from[0]; x <= to[0]; x++) {
            // the distance from the sphere's centre to the box of the cell
            let d2 = 0;
            const c = [x, y, z];
            for (let k = 0; k < 3; k++) {
              const a = lo[k] + c[k] * size[k], e = a + size[k];
              const q = Math.max(a - b.x[k], 0, b.x[k] - e);
              d2 += q * q;
            }
            if (d2 > reach * reach) continue;
            const o = ((z * gy + y) * gx + x) * (this.slots + 1);
            const count = this.cells[o];
            if (count >= this.slots) {
              overflow++;
              continue;
            }
            this.cells[o + 1 + count] = i;
            this.cells[o] = count + 1;
          }
    });
    return overflow;
  }
}
