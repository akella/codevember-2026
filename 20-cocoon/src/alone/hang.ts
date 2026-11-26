/** Where the cocoons hang and how they move: sines that fit the loop. And the threads they hang from. */

export type Pose = { R: number[]; t: number[] };
export type Hanging = {
  id: number;
  at: [number, number, number];
  /** the long axis off the plumb line: how far (radians), towards where; and which way round it faces */
  lean: number;
  towards: number;
  face: number;
  /** [turns a loop, size, phase] of the sway of the whole thread (two ways), the cocoon's rock, its turning to and fro */
  swayX: [number, number, number];
  swayZ: [number, number, number];
  rockX: [number, number, number];
  rockZ: [number, number, number];
  spin: [number, number, number];
};
const wave = (n: number, size: number, phase: number): [number, number, number] => [n, size, phase];

const ALONE: Hanging[] = [
  { id: 1, at: [-0.55, -0.15, 0.9], lean: 0.16, towards: 0.4, face: 0.0, swayX: wave(2, 0.011, 0.0), swayZ: wave(2, 0.016, 0.9), rockX: wave(5, 0.030, 0.3), rockZ: wave(5, 0.045, 1.2), spin: wave(1, 0.75, 0.1) },
  { id: 0, at: [0.85, 1.15, -0.45], lean: 0.2, towards: 2.6, face: 1.0, swayX: wave(2, 0.012, 2.1), swayZ: wave(2, 0.013, 3.4), rockX: wave(4, 0.034, 1.3), rockZ: wave(5, 0.036, 4.0), spin: wave(1, -0.9, 1.4) },
  { id: 2, at: [1.95, -1.35, 0.45], lean: 0.13, towards: 4.4, face: 2.2, swayX: wave(2, 0.010, 4.0), swayZ: wave(3, 0.010, 1.9), rockX: wave(5, 0.028, 2.5), rockZ: wave(4, 0.040, 0.4), spin: wave(1, 0.65, 2.8) },
  { id: 3, at: [-2.0, 0.75, -0.9], lean: 0.22, towards: 5.5, face: 3.9, swayX: wave(3, 0.009, 1.0), swayZ: wave(2, 0.013, 5.2), rockX: wave(4, 0.030, 5.1), rockZ: wave(5, 0.034, 2.2), spin: wave(1, -0.7, 4.0) },
  { id: 2, at: [-0.15, -2.25, -1.3], lean: 0.17, towards: 1.5, face: 5.1, swayX: wave(2, 0.011, 5.5), swayZ: wave(2, 0.012, 2.7), rockX: wave(5, 0.026, 0.9), rockZ: wave(4, 0.036, 3.3), spin: wave(1, 0.8, 5.3) },
];

/** tear.html: the first is torn out of its web, the others hang behind it */
const TORN: Hanging[] = [
  { ...ALONE[0], at: [-0.35, -0.25, 0.7], lean: 0.05 },
  { ...ALONE[1], at: [2.0, 1.9, -3.4] },
  { ...ALONE[3], at: [-3.0, 1.4, -2.7] },
  { ...ALONE[2], at: [3.2, -2.0, -2.4] },
  { ...ALONE[4], at: [-1.75, -2.7, -3.4] },
];
/** twist.html: wound up on two cords each, let go, and left to swing round till they are still */
const TWISTED: Hanging[] = [
  { ...ALONE[0], at: [-0.95, -1.15, 0.9], lean: 0.05 },
  { ...ALONE[1], at: [1.05, -0.2, -0.3], lean: 0.06 },
  { ...ALONE[2], at: [2.75, -1.75, 0.2], lean: 0.05 },
  { ...ALONE[3], at: [-2.75, -0.35, -0.5], lean: 0.06 },
  { ...ALONE[4], at: [0.35, -2.6, -1.6], lean: 0.05 },
];
const page = typeof document !== "undefined" ? document.documentElement.dataset.page : undefined;
export const TWISTING = page === "twist";
export const TEARING = typeof document !== "undefined" && document.documentElement.dataset.page === "tear";
export const HANGING = TEARING ? TORN : TWISTING ? TWISTED : ALONE;

/** above a cocoon's middle: where its silk has drawn together to a thread, and where that is held */
export const NECK = 2.35;
export const TOP = TWISTING ? 7.8 : 11;

// ---- rotations, as rows
const mul = (a: number[], b: number[]) => {
  const o: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  return o;
};
const on = (m: number[], v: number[]) => [0, 1, 2].map((r) => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]);
const rx = (a: number) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const ry = (a: number) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rz = (a: number) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
/** turned about a point */
const about = (R: number[], p: number[]): Pose => ({ R, t: on(R, p).map((x, k) => p[k] - x) });
const after = (a: Pose, b: Pose): Pose => ({ R: mul(a.R, b.R), t: on(a.R, b.t).map((x, k) => x + a.t[k]) });

/** from a cocoon's own frame (x its long axis) to how it hangs, its middle the origin, y up */
export const standing = (h: Hanging) => mul(ry(h.towards), mul(rz(h.lean), mul(ry(h.face - h.towards), rz(Math.PI / 2))));

export const poseOf = (h: Hanging, t: number, much: number) => {
  const s = ([n, size, phase]: [number, number, number]) => much * size * Math.sin(2 * Math.PI * n * t + phase);
  const spin = s(h.spin);
  if (TWISTING) {
    // wound, held, let go; what is left of the turning dies away before it is wound again
    const u = (((t + h.face * 0.37) % 1) + 1) % 1;
    const most = (h.spin[1] > 0 ? 1 : -1) * 10.5;
    const ease = (x: number) => {
      const k = Math.min(1, Math.max(0, x));
      return k * k * k * (k * (k * 6 - 15) + 10);
    };
    let turned: number;
    if (u < 0.5) turned = most * ease(u / 0.46) + 0.02 * Math.sin(u * 620) * ease((u - 0.36) / 0.1);
    else {
      const s = (u - 0.5) * 16;
      turned = most * Math.exp(-0.42 * s) * Math.cos(1.55 * s) * (1 - ease((u - 0.86) / 0.14)) + 0.0;
    }
    // the cords shorten as they wind about one another
    const up = 0.0072 * turned * turned;
    const rockT = about(mul(rx(s(h.rockX) * 0.5), rz(s(h.rockZ) * 0.5)), [0, NECK, 0]);
    const swingT = about(mul(rx(s(h.swayX)), rz(s(h.swayZ))), [0, TOP, 0]);
    const swayT: Pose = { R: swingT.R, t: swingT.t.map((x, k) => x + h.at[k] + (k === 1 ? up : 0)) };
    return { body: after(after(swayT, rockT), { R: mul(ry(turned), standing(h)), t: [0, 0, 0] }), sway: swayT, rock: rockT, spin: turned };
  }
  const rock = about(mul(rx(s(h.rockX)), rz(s(h.rockZ))), [0, NECK, 0]);
  const swing = about(mul(rx(s(h.swayX)), rz(s(h.swayZ))), [0, TOP, 0]);
  const sway: Pose = { R: swing.R, t: swing.t.map((x, k) => x + h.at[k]) };
  const body = after(after(sway, rock), { R: mul(ry(spin), standing(h)), t: [0, 0, 0] });
  return { body, sway, rock, spin };
};

// ---- the thread, as it hangs: strands of a twisted cord that opens over the cocoon's upper end

const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

export const cordPoints = (h: Hanging, shape: { A: number; B: number; p: number }, radius: number) => {
  const n = 64;
  const points = 176;
  const r = random(7 + h.id * 101 + Math.round(h.face * 1000));
  const M = standing(h);
  const at = (d: number[]) => {
    const rho = Math.hypot(d[1], d[2]);
    const w = (1 + 0.05 * d[0]) * (1 - 0.022 * Math.exp(-((d[0] / 0.42) ** 2)));
    const R = ((Math.abs(d[0]) / shape.A) ** shape.p + (rho / (shape.B * w)) ** shape.p) ** (-1 / shape.p) + 0.006;
    return on(M, d.map((x) => x * R));
  };
  const data = new Float32Array(n * points * 4);
  for (let i = 0; i < n; i++) {
    const a0 = r() * 6.283;
    const open = 0.16 + 1.0 * r() ** 0.8;                    // how far from the tip it is tied
    const tip = [1, open * Math.cos(a0), open * Math.sin(a0)];
    const l = Math.hypot(...tip);
    const end = at(tip.map((x) => x / l));
    const turn = r() * 6.283;
    const thick = 0.004 + 0.016 * Math.sqrt(r());
    const leaves = NECK - 0.75 + 0.95 * r() ** 1.6;          // how high it leaves the cord
    const k = Array.from({ length: 9 }, () => r());
    const loose = 0.35 + 1.1 * r();
    const cord = 100;
    for (let j = 0; j < points; j++) {
      let p: number[];
      const twist = (y: number) => {
        const a = turn + (TOP - y) * 4.4;
        const w = thick * (1 + 0.25 * Math.sin(y * 5 + turn)) * (1 + 1.6 * Math.exp(-((y - leaves) ** 2) * 3));
        return [Math.cos(a) * w + 0.012 * Math.sin(y * 1.9 + 1), y, Math.sin(a) * w + 0.010 * Math.sin(y * 2.3)];
      };
      if (TWISTING) {
        // two cords, apart above, tied at the neck
        const leg = i % 2 ? 1 : -1;
        const tw = twist;
        const legAt = (y: number) => {
          const q = tw(y);
          return [q[0] + leg * 0.5 * Math.max(0, (y - NECK + 0.1) / (TOP - NECK)) ** 0.8, q[1], q[2]];
        };
        if (j < cord) p = legAt(TOP + (leaves - TOP) * (j / (cord - 1)));
        else p = [0, 0, 0];
      } else p = [0, 0, 0];
      if (TWISTING && j < cord) void 0;
      else if (j < cord) p = twist(TOP + (leaves - TOP) * (j / (cord - 1)));
      else {
        const u = (j - cord + 1) / (points - cord);
        const b0 = twist(leaves);
        const reach = Math.hypot(...end.map((x, c) => x - b0[c]));
        const b1 = [b0[0], b0[1] - reach * 0.42, b0[2]];
        const out = end.map((x, c) => x + (b0[c] - x) * 0.22 + (c === 1 ? 0.05 : x * 0.12));
        p = [0, 1, 2].map((c) => (1 - u) ** 3 * b0[c] + 3 * (1 - u) ** 2 * u * b1[c] + 3 * (1 - u) * u * u * out[c] + u ** 3 * end[c]);
        const amp = loose * Math.sin(Math.PI * u) ** 0.7;
        for (let c = 0; c < 3; c++)
          p[c] += amp * (0.045 * Math.sin(u * reach * 7.0 * (0.7 + 0.6 * k[c]) + k[c + 3] * 40) + 0.022 * Math.sin(u * reach * 17 * (0.7 + 0.6 * k[c + 3]) + k[c + 6] * 40) + 0.008 * Math.sin(u * reach * 37 + k[c] * 60));
      }
      const thin = Math.abs((2 * j) / (points - 1) - 1) ** 3;
      data.set([...p, radius * (1 - 0.35 * thin)], (i * points + j) * 4);
    }
  }
  return { n, points, data };
};

/** tear.html: the two threads a web hangs from, `wide` apart each way, their ends `over` the cocoon's middle */
export const twoThreads = (wide: number, over: number, radius: number) => {
  const n = 64;
  const points = 176;
  const r = random(99);
  const data = new Float32Array(n * points * 4);
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    const turn = r() * 6.283;
    const thick = 0.003 + 0.014 * Math.sqrt(r());
    const end = over - 0.15 + 0.9 * r() ** 2;
    const loose = [r() - 0.5, r() - 0.5, r()];
    for (let j = 0; j < points; j++) {
      const y = TOP + (end - TOP) * (j / (points - 1));
      const a = turn + (TOP - y) * 4.4;
      const open = Math.exp(-Math.max(0, y - over) * 2.2);
      const w = thick * (1 + 0.25 * Math.sin(y * 5 + turn)) * (1 + 1.4 * open);
      const p = [side * wide + Math.cos(a) * w + 0.012 * Math.sin(y * 1.9 + side) * (1 - open) + loose[0] * 0.10 * open * open, y, Math.sin(a) * w + 0.010 * Math.sin(y * 2.3 + side) * (1 - open) + loose[1] * 0.10 * open * open];
      data.set([...p, radius * (1 - 0.35 * (j / (points - 1)) ** 4)], (i * points + j) * 4);
    }
  }
  return { n, points, data };
};
