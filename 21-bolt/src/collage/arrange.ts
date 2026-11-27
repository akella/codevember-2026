// Where the clouds go: whole CloudPack clouds, upright, each turned about the vertical, maybe mirrored, of some size,
// placed so that seen from the front, at a coarse scale only, all of them together cover her outline and leave her
// eyes open. Nothing else is asked of them, so up close and from the side they are just clouds.
// Simulated annealing over the pieces, on pictures of each cloud seen from twelve ways, worked out once.
import type { V3 } from "../blades.ts";
import { random } from "../bolt.ts";

export const TURNS = 12;
// (the dragon is 4 long, nose to tail; the places on it here and in drift/index.ts were measured at 3.3)
export const DRAGON = 4.0 / 3.3;
const PX = 0.04; // a pixel of a cloud's picture, at size 1

export type Cloud = { dims: V3; most: number; bytes: Uint8Array; source: number };
// one cloud seen one way: optical depth, at size 1
type Seen = { w: number; h: number; ox: number; oy: number; tau: Float32Array };
export type Piece = { cloud: number; turn: number; mirror: boolean; size: number; x: number; y: number; z: number; jitter: number; roll: number };
export type Ask = {
  pieces: number;
  seed: number;
  smallest: number;
  largest: number;
  eyes: number; // how open her eyes are
  loose: number; // how coarse the likeness is
  deep: number; // how far in and out of her they go
  soft: number; // optical depth to cover
  half: V3; // of the block
  steps: number;
  tilt: number; // how far over a cloud may lean, radians
  far: number; // how far off the eye is, straight in front: the search is in its perspective
  eyeY: number; // and how high
  shape?: "suzanne" | "dragon"; // what is to be seen in them
  eyeX?: number; // how far across the eye is (0: straight in front)
};
export type Outline = { nx: number; ny: number; nz: number; half: V3; at: (x: number, y: number, z: number) => number };

// ---- each cloud, seen from twelve ways about the vertical ----
export const look = (clouds: Cloud[]): Seen[][] =>
  clouds.map(({ dims: [W, H, D], most, bytes, source }) => {
    const out: Seen[] = [];
    for (let j = 0; j < TURNS; j++) {
      const a = (2 * Math.PI * j) / TURNS;
      const [c, s] = [Math.cos(a), Math.sin(a)];
      const half = 0.5 * source * Math.hypot(W, D);
      const w = Math.ceil((2 * half) / PX) + 2;
      const h = Math.ceil((H * source) / PX) + 2;
      const tau = new Float32Array(w * h);
      const ox = w / 2;
      const oy = h / 2;
      // (every other voxel: each stands for eight)
      const per = (source * 2) ** 3 / (PX * PX);
      for (let k = 0; k < D; k += 2)
        for (let y = 0; y < H; y += 2)
          for (let i = 0; i < W; i += 2) {
            const v = bytes[(k * H + y) * W + i] / 255;
            if (v < 0.02) continue;
            const lx = (i + 1 - W / 2) * source;
            const lz = (k + 1 - D / 2) * source;
            const ly = (y + 1 - H / 2) * source;
            const X = c * lx + s * lz; // (R_y(a) of the cloud's own axes: x goes to (cos a, 0, -sin a), z to (sin a, 0, cos a))
            const u = Math.floor(X / PX + ox);
            const t = Math.floor(ly / PX + oy);
            tau[t * w + u] += v * v * most * per;
          }
      // (a little blur: every other voxel leaves a weave)
      const b = new Float32Array(w * h);
      for (let t = 1; t < h - 1; t++)
        for (let u = 1; u < w - 1; u++) {
          let sum = 0;
          for (let dt = -1; dt <= 1; dt++) for (let du = -1; du <= 1; du++) sum += tau[(t + dt) * w + u + du] * (dt || du ? (dt && du ? 1 : 2) : 4);
          b[t * w + u] = sum / 16;
        }
      out.push({ w, h, ox, oy, tau: b });
    }
    return out;
  });

// ---- what is asked for: her outline from the front, her eyes open ----
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const target = (her: Outline, ask: Ask) => {
  const g = 0.06 * ask.loose;
  const nx = Math.round((2 * ask.half[0]) / g);
  const ny = Math.round((2 * ask.half[1]) / g);
  const want = new Float32Array(nx * ny);
  const weight = new Float32Array(nx * ny);
  const mid = new Float32Array(nx * ny); // how deep her middle is there
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = ((i + 0.5) / nx - 0.5) * 2 * ask.half[0];
      const y = ((j + 0.5) / ny - 0.5) * 2 * ask.half[1];
      let near = 9;
      let [sum, n] = [0, 0];
      for (let z = -her.half[2]; z < her.half[2]; z += 0.03) {
        const d = her.at(x, y, z);
        near = Math.min(near, d);
        if (d < 0) [sum, n] = [sum + z, n + 1];
      }
      const k = j * nx + i;
      if (ask.shape === "dragon") {
        // (the dragon has no eyes to keep open: it is read by its gaps instead, the open jaws, between the coils, under
        // its neck, so the air close outside it counts most, and its head counts twice)
        want[k] = smooth(0.04, -0.04, near);
        const gap = near > 0 ? smooth(0.28, 0.04, near) : 0;
        const [hx, hy] = [x / DRAGON, y / DRAGON];
        const head = smooth(0.25, -0.1, Math.max(-1.75 - hx, hx - 0.05, 0.15 - hy, hy - 1.25));
        // (and between its jaws above all, as her eyes were)
        const jaws = near > 0 ? smooth(0.3, 0.05, Math.max(-2.0 - hx, hx + 1.0, 0.44 - hy, hy - 0.6)) : 0;
        weight[k] = (1 + 3 * gap + 6 * jaws + 0.8 * want[k] * smooth(-0.2, -0.04, near)) * (1 + head);
        mid[k] = n ? sum / n : 0;
        continue;
      }
      const ex = (Math.abs(x) - 0.37) / (0.25 * ask.eyes);
      const ey = (y - 0.25) / (0.22 * ask.eyes);
      const eye = smooth(1.15, 0.85, Math.hypot(ex, ey));
      want[k] = smooth(0.04, -0.04, near) * (1 - eye);
      // (and what is round the eyes must be there: the bridge of her nose above all)
      const ring = smooth(1.9, 1.2, Math.hypot(ex, ey)) * (1 - eye);
      weight[k] = 1 + 3 * eye + 2 * ring * want[k];
      mid[k] = n ? sum / n : 0;
    }
  return { nx, ny, g, want, weight, mid };
};

// ---- the search ----
export const arrange = (seen: Seen[][], her: Outline, ask: Ask) => {
  const T = target(her, ask);
  const { nx, ny, g, want, weight } = T;
  const tau = new Float32Array(nx * ny);
  const rand = random(ask.seed * 7919 + 13);
  // how far in it is, and so how large it looks
  const zOf = (p: Piece) => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((p.x + ask.half[0]) / g)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor((p.y + ask.half[1]) / g)));
    return T.mid[j * nx + i] * 0.6 - (p.size - 0.3) * 0.5 + p.jitter * ask.deep;
  };
  const seenAs = (p: Piece) => {
    const f = ask.far / (ask.far - zOf(p));
    const ex = ask.eyeX ?? 0;
    return { x: ex + (p.x - ex) * f, y: ask.eyeY + (p.y - ask.eyeY) * f, size: p.size * f, c: Math.cos(p.roll), n: Math.sin(p.roll) };
  };
  // (leaning, it takes up more room)
  const room = (q: Piece, size: number) => {
    const s = seen[q.cloud][q.turn];
    const [w, h] = [(s.w / 2) * PX * size, (s.h / 2) * PX * size];
    const [c, n] = [Math.abs(Math.cos(q.roll)), Math.abs(Math.sin(q.roll))];
    return [c * w + n * h, n * w + c * h];
  };
  const box = (q: Piece) => {
    const p = seenAs(q);
    const [hw, hh] = room(q, p.size);
    const i0 = Math.max(0, Math.floor((p.x - hw + ask.half[0]) / g));
    const i1 = Math.min(nx - 1, Math.ceil((p.x + hw + ask.half[0]) / g));
    const j0 = Math.max(0, Math.floor((p.y - hh + ask.half[1]) / g));
    const j1 = Math.min(ny - 1, Math.ceil((p.y + hh + ask.half[1]) / g));
    return [i0, i1, j0, j1];
  };
  // (a piece's optical depth at the middle of a cell)
  const of = (q: Piece, p: ReturnType<typeof seenAs>, i: number, j: number) => {
    const s = seen[q.cloud][q.turn];
    const dx = ((i + 0.5) * g - ask.half[0] - p.x) / p.size;
    const dy = ((j + 0.5) * g - ask.half[1] - p.y) / p.size;
    // (leaning over turns its picture: back again, to look it up)
    const X = p.c * dx + p.n * dy;
    const Y = -p.n * dx + p.c * dy;
    const u = (q.mirror ? -X : X) / PX + s.ox - 0.5;
    const v = Y / PX + s.oy - 0.5;
    const u0 = Math.floor(u);
    const v0 = Math.floor(v);
    if (u0 < 0 || v0 < 0 || u0 >= s.w - 1 || v0 >= s.h - 1) return 0;
    const [fu, fv] = [u - u0, v - v0];
    const t = s.tau;
    const a = t[v0 * s.w + u0] * (1 - fu) + t[v0 * s.w + u0 + 1] * fu;
    const b = t[(v0 + 1) * s.w + u0] * (1 - fu) + t[(v0 + 1) * s.w + u0 + 1] * fu;
    return (a * (1 - fv) + b * fv) * q.size;
  };
  const add = (p: Piece, sign: number) => {
    const [i0, i1, j0, j1] = box(p);
    const q = seenAs(p);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) tau[j * nx + i] += sign * of(p, q, i, j);
  };
  const cover = (t: number) => 1 - Math.exp(-Math.max(0, t) * ask.soft);
  const err = (i0: number, i1: number, j0: number, j1: number) => {
    let e = 0;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        const d = cover(tau[k]) - want[k];
        e += d * d * weight[k];
      }
    return e;
  };
  // a cloud must stay inside the block, all of it
  const fits = (p: Piece) => {
    const [w, h] = room(p, p.size);
    return Math.abs(p.x) + w < ask.half[0] - 0.06 && Math.abs(p.y) + h < ask.half[1] - 0.06;
  };
  const sized = () => ask.smallest * (ask.largest / ask.smallest) ** rand();
  const fresh = (): Piece => {
    for (;;) {
      const [sx, sy] = ask.shape === "dragon" ? [2 * ask.half[0] - 0.5, 2 * ask.half[1] - 0.5] : [2.6, 1.9];
      const p = { cloud: Math.floor(rand() * seen.length), turn: Math.floor(rand() * TURNS), mirror: rand() < 0.5, size: sized(), x: (rand() - 0.5) * sx, y: (rand() - 0.5) * sy, z: 0, jitter: rand() * 2 - 1, roll: (rand() * 2 - 1) * ask.tilt };
      if (fits(p)) return p;
    }
  };
  const pieces = Array.from({ length: ask.pieces }, fresh);
  for (const p of pieces) add(p, 1);
  const [hot, cold] = [3, 0.004];
  let tried = 0;
  let taken = 0;
  for (let n = 0; n < ask.steps; n++) {
    const heat = hot * (cold / hot) ** (n / ask.steps);
    const k = Math.floor(rand() * pieces.length);
    const old = pieces[k];
    const p = { ...old };
    const r = rand();
    const step = 0.05 + 0.4 * Math.sqrt(heat / hot);
    if (r < 0.45) {
      p.x += (rand() - 0.5) * step;
      p.y += (rand() - 0.5) * step;
    } else if (r < 0.65) p.size = Math.min(ask.largest, Math.max(ask.smallest, p.size * Math.exp((rand() - 0.5) * step)));
    else if (r < 0.8) p.turn = (p.turn + (rand() < 0.5 ? 1 : TURNS - 1)) % TURNS;
    else if (r < 0.84) p.mirror = !p.mirror;
    else if (r < 0.9) p.roll = Math.max(-ask.tilt, Math.min(ask.tilt, p.roll + (rand() - 0.5) * step));
    else if (r < 0.96) p.cloud = Math.floor(rand() * seen.length);
    else Object.assign(p, fresh());
    if (!fits(p)) continue;
    tried++;
    const [a0, a1, b0, b1] = box(old);
    const [c0, c1, d0, d1] = box(p);
    const area = [Math.min(a0, c0), Math.max(a1, c1), Math.min(b0, d0), Math.max(b1, d1)] as const;
    const before = err(...area);
    add(old, -1);
    add(p, 1);
    const after = err(...area);
    if (after <= before || rand() < Math.exp((before - after) / heat)) {
      pieces[k] = p;
      taken++;
    } else {
      add(p, -1);
      add(old, 1);
    }
  }
  // how far in and out: about her middle there, the large ones further back
  for (const p of pieces) p.z = zOf(p);
  const cover2 = Float32Array.from(tau, cover);
  return { pieces, error: err(0, nx - 1, 0, ny - 1), tried, taken, nx, ny, want, cover: cover2 };
};

// her outline, from tools/suzanne-cloud.py's distances (signed, a byte each, 0.4 at 127)
export const outlineOf = (nx: number, ny: number, nz: number, half: V3, distances: Int8Array): Outline => ({
  nx, ny, nz, half,
  at: (x, y, z) => {
    const c = [x, y, z].map((v, a) => Math.floor((v / half[a] + 1) * 0.5 * [nx, ny, nz][a]));
    if (c.some((v, a) => v < 0 || v >= [nx, ny, nz][a])) return 0.4;
    return (distances[(c[2] * ny + c[1]) * nx + c[0]] / 127) * 0.4;
  },
});
