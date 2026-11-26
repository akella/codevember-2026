/**
 * Where everything is. Each column is one cocoon's life, over and over: it comes down on its thread, its web tears,
 * it falls, and what is left of the web is drawn back up, out of the picture. All as a function of its age; the
 * columns are as many ages. How a web tears is worked out beforehand (../alone/tear.ts), once for each of the four
 * cocoons: coming down steadily changes nothing about it.
 */
import { matOf, type Tear } from "../alone/tear";

export type Pose = { R: number[]; t: number[] };
export type Column = { id: number; x: number; z: number; phase: number; face: number; /** where it lets go: -1 the bottom of the picture, 1 its top */ low: number; wait: number; swing: [number, number, number, number]; /** not in this picture: it is too narrow */ away?: boolean; room?: number };

export const COLUMNS = 22;
/** how far before and behind the middle most of them hang */
const LAYER = 1.15;
/** seconds a life takes, and the loop */
export const LIFE = 24;
/** the tearing is played this fast: a cocoon is light and the lens is close */
const RATE = 0.82;
/** the thread's end above a cocoon's middle; and how much of it gives */
export const OVER = 2.15;
export const GIVES = 5;
export const SECONDS = 12;
/** own frame (x along) to hanging (y up), as rows */
export const STANDING = [0, -1, 0, 1, 0, 0, 0, 0, 1];
export const TEARS = [
  { seed: 10, lopsided: 0.9, tire: 0.7 },
  { seed: 107, lopsided: 0.9, tire: 0.7 },
  { seed: 212, lopsided: 0.7, tire: 1.5 },
  { seed: 304, lopsided: 0.7, tire: 0.7 },
].map((o) => ({ ...o, seconds: SECONDS, over: OVER, wide: 0, standing: STANDING, kin: 0.3, thread: { length: GIVES, stiff: 62, drag: 1.5 } }));

const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
const TAN = Math.tan((14 * Math.PI) / 180);
export const FAR = 13;
const high = (z: number) => (FAR - z) * TAN;

/** how high a cocoon's middle is, at an age; and once it has come off */
const height = (c: Column, last: number, age: number) => {
  const top = high(c.z) + 1.35;
  const speed = (top - c.low * high(c.z)) / last;
  const y = top - speed * Math.min(age, last);
  return age > last ? y - speed * (age - last) - 4.2 * (age - last) ** 2 : y;
};
const lastOf = (c: Column, tears: Tear[]) => tears[c.id].last / RATE + c.wait;

/**
 * The columns: most in one thin layer, where the lens is sharp, a few behind it; over the picture's width; each where
 * it comes least near the others, and they its thread, at any time of the loop.
 */
export const layOut = (aspect: number, tears: Tear[]): Column[] => {
  const r = random(11);
  const wide = Math.min(2.0, Math.max(0.7, aspect));
  const many = Math.min(COLUMNS, Math.round(8 + 8 * wide));
  const out: Column[] = [];
  const TIMES = 72;
  const ages = (c: Column) => Array.from({ length: TIMES }, (_, k) => ((((k / TIMES + c.phase) % 1) + 1) % 1) * LIFE);
  const tracks: { y: number[]; there: boolean[]; line: boolean[] }[] = [];
  const track = (c: Column) => {
    const last = lastOf(c, tears);
    const A = ages(c);
    const y = A.map((a) => height(c, last, a));
    return { y, there: y.map((v) => v > -high(c.z) - 1.5), line: A.map((a) => a < last + 2.5) };
  };
  for (let i = 0; i < COLUMNS; i++) {
    const base = {
      id: i % 4,
      phase: (i * 0.6180339 + 0.1) % 1,
      face: r() * Math.PI * 2,
      low: 0.0 - 0.92 * ((i * 0.7548777 + 0.2) % 1),
      wait: 3.2 + 4.3 * ((i * 0.5698403 + 0.6) % 1),
      swing: [0.006 + 0.006 * r(), r() * 6.28, 0.006 + 0.006 * r(), r() * 6.28] as Column["swing"],
    };
    let best: Column | undefined;
    let bestTrack: (typeof tracks)[number] | undefined;
    let room = -Infinity;
    for (let k = 0; k < (i < many ? 260 : 0); k++) {
      // one in six behind the others
      const z = i % 6 === 5 ? -2.4 - 2.8 * r() : LAYER * (2 * r() - 1);
      const c: Column = { ...base, x: (2 * r() - 1) * (high(z) * wide * 0.98), z };
      const mine = track(c);
      let gap = 3;
      for (let j = 0; j < out.length; j++) {
        const o = out[j];
        const flat = Math.hypot(o.x - c.x, o.z - c.z);
        // its thread, the other's
        gap = Math.min(gap, (flat - 0.86) * 1.2);
        if (flat > 2.6) continue;
        for (let t = 0; t < TIMES; t++) {
          if (!mine.there[t] || !tracks[j].there[t]) continue;
          gap = Math.min(gap, Math.hypot(flat, (mine.y[t] - tracks[j].y[t]) * 0.72) - 1.55);
        }
      }
      if (gap > room) {
        room = gap;
        best = c;
        bestTrack = mine;
      }
    }
    if (best && bestTrack) {
      out.push({ ...best, room });
      tracks.push(bestTrack);
    } else out.push({ ...base, x: 0, z: 0, away: true });
  }
  return out;
};

const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

// ---- rotations, as rows
const mul = (a: number[], b: number[]) => {
  const o: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  return o;
};
const on = (m: number[], v: number[]) => [0, 1, 2].map((r) => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]);
const after = (a: Pose, b: Pose): Pose => ({ R: mul(a.R, b.R), t: on(a.R, b.t).map((x, k) => x + a.t[k]) });

export const where = (c: Column, tears: Tear[], t: number, sway: number) => {
  const tear = tears[c.id];
  const age = ((((t + c.phase) % 1) + 1) % 1) * LIFE;
  const last = lastOf(c, tears);
  const top = high(c.z) + 1.35;
  const speed = (top - c.low * high(c.z)) / last;
  const y = c.away ? 1e3 : top - speed * age;
  // when nothing holds it, the line goes up again
  const gone = Math.max(0, age - last);
  const y1 = top - speed * last;
  const spare = LIFE - 0.1 - last;
  const rise = (high(c.z) - y1 + 1.2 + speed * spare) * ease((gone - 0.15) / (spare - 0.2));

  const g = Math.min(Math.max(0, (age - c.wait) * RATE * tear.fps), tear.frames - 1.001);
  const f = Math.floor(g);
  const w = g - f;
  const B = tear.body;
  const p = [0, 1, 2].map((k) => B[f * 7 + k] * (1 - w) + B[f * 7 + 7 + k] * w);
  const q0 = [3, 4, 5, 6].map((k) => B[f * 7 + k]);
  const q1 = [3, 4, 5, 6].map((k) => B[f * 7 + 7 + k]);
  const sign = q0.reduce((a, x, k) => a + x * q1[k], 0) < 0 ? -1 : 1;
  let q = q0.map((x, k) => x * (1 - w) + sign * q1[k] * w);
  const l = Math.hypot(...q);
  q = q.map((x) => x / l);
  const end = [0, 1, 2].map((k) => tear.end[f * 3 + k] * (1 - w) + tear.end[f * 3 + 3 + k] * w);

  // the whole line sways a little, from far above, and is turned to face anywhere
  const two = Math.PI * 2;
  const [ax, az] = [sway * c.swing[0] * Math.sin(two * 3 * t + c.swing[1]), sway * c.swing[2] * Math.sin(two * 2 * t + c.swing[3])];
  const S = mul([1, 0, 0, 0, Math.cos(ax), -Math.sin(ax), 0, Math.sin(ax), Math.cos(ax)], [Math.cos(az), -Math.sin(az), 0, Math.sin(az), Math.cos(az), 0, 0, 0, 1]);
  const pivot = [0, 9, 0];
  const swung: Pose = { R: S, t: on(S, pivot).map((x, k) => pivot[k] - x) };
  const turn = [Math.cos(c.face), 0, Math.sin(c.face), 0, 1, 0, -Math.sin(c.face), 0, Math.cos(c.face)];
  const placed = (dy: number): Pose => after({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [c.x, y + dy, c.z] }, after(swung, { R: turn, t: [0, 0, 0] }));
  const below = placed(0);
  const above = placed(rise);
  // the thread leans and stretches to where its end is
  const cord = after(above, {
    R: [1, -end[0] / GIVES, 0, 0, 1 - end[1] / GIVES, 0, 0, -end[2] / GIVES, 1],
    t: end.map((e) => (e * (OVER + GIVES)) / GIVES),
  });
  return { body: after(below, { R: matOf(q), t: p }), above, below, cord, frame: g, y, gone, age };
};

/** the thread above the web's strands */
export const cordPoints = (radius: number) => {
  const n = 26;
  const points = 110;
  const r = random(99);
  const data = new Float32Array(n * points * 4);
  for (let i = 0; i < n; i++) {
    const turn = r() * 6.283;
    const thick = 0.003 + 0.014 * Math.sqrt(r());
    const end = OVER - 0.1 + 0.8 * r() ** 2;
    const loose = [r() - 0.5, r() - 0.5];
    for (let j = 0; j < points; j++) {
      const y = OVER + 10 + (end - OVER - 10) * (j / (points - 1));
      const a = turn + y * 4.4;
      const open = Math.exp(-Math.max(0, y - OVER) * 2.2);
      const w = thick * (1 + 0.25 * Math.sin(y * 5 + turn)) * (1 + 1.2 * open);
      data.set([Math.cos(a) * w + 0.012 * Math.sin(y * 1.9) * (1 - open) + loose[0] * 0.07 * open * open, y, Math.sin(a) * w + 0.010 * Math.sin(y * 2.3) * (1 - open) + loose[1] * 0.07 * open * open, radius * 1.5 * (1 - 0.35 * (j / (points - 1)) ** 4)], (i * points + j) * 4);
    }
  }
  return { n, points, data };
};
