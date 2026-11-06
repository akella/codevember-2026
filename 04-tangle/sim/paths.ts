// The deterministic half of the piece: where every head goes.
// Rope is laid along these curves ahead of the head and only becomes physics behind it.

export type Params = {
  seed: number;
  count: number;
  /** seconds per loop */
  period: number;
  /** world units the heads advance per loop */
  pitch: number;
  /** node spacing along a laid curve */
  spacing: number;
  /** rope radius */
  radius: number;
  rMin: number;
  rMax: number;
  /** winding per loop for each rope, picked in turn. Mixed signs braid, one sign cables */
  turns: number[];
  /** how much the orbit radius breathes over a loop, 0 to 1 */
  wobble: number;
  /** bending and twisting stiffness (Bergou's alpha and beta) */
  bend: number;
  twist: number;
  /** mass per unit length */
  density: number;
  /** air drag, 1/s */
  drag: number;
  /** velocity smoothing per substep, 0 to 1/16 */
  smooth: number;
  /** 0 keeps the laid length, 1 shrinks each rope to fit a tight cable of radius `bundle` */
  tighten: number;
  bundle: number;
  /** where the shrink starts and ends, in nodes behind the head */
  shrinkFrom: number;
  shrinkTo: number;
  /** pull towards the axis, units/s², ramped in with the shrink */
  pull: number;
  /** nodes behind the head that are simulated. Older rope is frozen */
  window: number;
  /** nodes behind the head that stay on the curve, so the tip leaves the head cleanly */
  lag: number;
  /** full turns of twist laid into the rope per loop */
  spin: number;
  friction: number;
  /** fastest two overlapping ropes may push apart, units/s */
  separate: number;
  /** substeps per second */
  rate: number;
  /** collision candidates are rebuilt every this many substeps */
  broadEvery: number;
};

export const defaults: Params = {
  seed: 679,
  count: 25,
  period: 6,
  pitch: 10,
  spacing: 0.1,
  radius: 0.07,
  rMin: 0.1,
  rMax: 2,
  turns: [1],
  wobble: 0,
  bend: 1,
  twist: 1,
  density: 1,
  drag: 1.5,
  smooth: 0.02,
  tighten: 0.6,
  bundle: 0.45,
  shrinkFrom: 10,
  shrinkTo: 90,
  pull: 0,
  window: 220,
  lag: 3,
  spin: 0,
  friction: 0.3,
  separate: 4,
  rate: 960,
  broadEvery: 4,
};

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** spirals' easeSpeed: 2x³ - 3x² + 2x, stretched over every whole number */
export const easeSpeed = (y: number) => {
  const whole = Math.floor(y);
  const x = y - whole;
  return whole + 2 * x ** 3 - 3 * x ** 2 + 2 * x;
};

export type Rope = {
  index: number;
  /** nodes laid per loop */
  K: number;
  /** one loop of the curve, arc-length spaced, K points, xyz */
  table: Float64Array;
  /** arc length of one loop */
  length: number;
  /** its place in the ease, 0 to 1 */
  offset: number;
  orbit: number;
  turns: number;
  /** curve parameter at the head when the loop starts */
  start: number;
  /** rest length per laid length once the rope has tightened */
  shrink: number;
};

/** The orbit in the plane across the axis */
function orbit(u: number, R: number, phase: number, turns: number, wobble: number, breathe: number) {
  const r = R * (1 + wobble * Math.sin(2 * Math.PI * u * 2 + breathe));
  const a = turns * 2 * Math.PI * u + phase;
  return [r * Math.sin(a), r * Math.cos(a)];
}

export function makeRopes(p: Params): Rope[] {
  const random = mulberry32(p.seed);
  const ropes: Rope[] = [];
  for (let i = 0; i < p.count; i++) {
    const R = p.rMin + ((p.rMax - p.rMin) * i) / p.count;
    const phase = random() * 2 * Math.PI;
    const offset = random();
    const breathe = random() * 2 * Math.PI;
    const turns = p.turns[Math.floor(random() * p.turns.length)];

    // sample finely, then respace by arc length so every edge starts the same length
    const fine = 4096;
    const xs = new Float64Array((fine + 1) * 3);
    const along = new Float64Array(fine + 1);
    for (let k = 0; k <= fine; k++) {
      const u = k / fine;
      const [y, z] = orbit(u, R, phase, turns, p.wobble, breathe);
      xs.set([p.pitch * u, y, z], k * 3);
      if (k) along[k] = along[k - 1] + Math.hypot(xs[k * 3] - xs[k * 3 - 3], xs[k * 3 + 1] - xs[k * 3 - 2], xs[k * 3 + 2] - xs[k * 3 - 1]);
    }
    const length = along[fine];
    const K = Math.round(length / p.spacing);
    const table = new Float64Array(K * 3);
    for (let k = 0, at = 0; k < K; k++) {
      const s = (k / K) * length;
      while (along[at + 1] < s) at++;
      const f = (s - along[at]) / (along[at + 1] - along[at]);
      for (let c = 0; c < 3; c++) table[k * 3 + c] = xs[at * 3 + c] + (xs[at * 3 + 3 + c] - xs[at * 3 + c]) * f;
    }
    // a straight run of the cable costs this much per loop, whatever the orbit was
    const tight = Math.hypot(p.pitch, 2 * Math.PI * p.bundle * Math.abs(turns));
    ropes.push({
      index: i,
      K,
      table,
      length,
      offset,
      orbit: R,
      turns,
      start: easeSpeed(offset) - offset,
      shrink: 1 + (tight / length - 1) * p.tighten,
    });
  }
  return ropes;
}

/** Curve position at a laid index, which can be fractional and run past one loop */
export function curveAt(rope: Rope, pitch: number, j: number, out: Float64Array | number[], at = 0) {
  const { K, table } = rope;
  const wrap = Math.floor(j / K);
  const q = j - wrap * K;
  const i1 = Math.floor(q);
  const f = q - i1;
  const point = (i: number, c: number) => {
    const w = Math.floor(i / K);
    return table[(i - w * K) * 3 + c] + (c === 0 ? w * pitch : 0);
  };
  for (let c = 0; c < 3; c++) {
    const a = point(i1 - 1, c);
    const b = point(i1, c);
    const d = point(i1 + 1, c);
    const e = point(i1 + 2, c);
    // Catmull-Rom, so the head moves without kinks
    const value = b + 0.5 * f * (d - a + f * (2 * a - 5 * b + 4 * d - e + f * (3 * (b - d) + e - a)));
    out[at + c] = value + (c === 0 ? wrap * pitch : 0);
  }
}

/** Head's place along the rope at a phase of the loop, in nodes since the loop began */
export const headProgress = (rope: Rope, phase: number) =>
  rope.K * (easeSpeed(phase + rope.offset) - easeSpeed(rope.offset));
