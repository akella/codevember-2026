/** How the hero cocoon hangs and turns, what is in it, and the silk it hangs by. */
export type Pose = { R: number[]; t: number[] };
type V = [number, number, number];
export const DURATION = 32;
const TOP = 9;
const mul = (a: number[], b: number[]) => {
  const o: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  return o;
};
const rx = (a: number) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const ry = (a: number) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rz = (a: number) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
/** own frame (x its long axis, head's end) to hanging, as rows: a little off the plumb line */
export const STANDING = mul(rz(0.1), mul(ry(0.6), rz(Math.PI / 2)));
const TAU = Math.PI * 2;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** the whole of it turns to and fro on its thread, and sways */
export const lineAt = (t: number, much: number): Pose => {
  const spin = much * (1.0 * Math.sin(TAU * t) + 0.06 * Math.sin(TAU * 5 * t + 1));
  const [ax, az] = [much * 0.010 * Math.sin(TAU * 3 * t + 0.7), much * 0.013 * Math.sin(TAU * 2 * t + 2.1)];
  const R = mul(mul(rx(ax), rz(az)), ry(spin));
  const p = [0, TOP, 0];
  return { R, t: [0, 1, 2].map((k) => p[k] - (R[k * 3] * p[0] + R[k * 3 + 1] * p[1] + R[k * 3 + 2] * p[2])) };
};

/** how much light is inside: none, then it comes up, lives, and goes out */
export const glow = (t: number, mode: string, flicker: number) => {
  const u = ((t % 1) + 1) % 1;
  const up = mode === "lantern" ? 1 : mode === "day" ? 0 : smooth(0.14, 0.34, u) * (1 - smooth(0.76, 0.94, u));
  const s = (k: number, p: number) => Math.sin(TAU * k * u + p);
  return up * (1 + flicker * (0.05 * s(16, 0) + 0.035 * s(37, 1) + 0.03 * s(61, 2) * s(7, 1)));
};

/** the pupa and the lamp, in the cocoon's own frame; R: how the cocoon is turned (rows) */
export const inside = (R: number[], t: number, size: number) => {
  const back = (v: number[]) => [0, 1, 2].map((k) => R[k] * v[0] + R[3 + k] * v[1] + R[6 + k] * v[2]);
  const eye = back([0, 0, 1]);
  const down = back([0, -1, 0]);
  // it lies on the wall that is before us half way through, and is turned away with it
  const a0 = Math.atan2(STANDING[8], STANDING[7]) + 0.25;
  const [a, b] = [Math.cos(a0), Math.sin(a0)];
  const s = (k: number, p: number) => Math.sin(TAU * k * t + p);
  const stir = Math.max(0, s(4, 0.4)) ** 4 + 0.6 * Math.max(0, s(7, 2.2)) ** 8;
  const bend = 0.04 + 0.02 * s(3, 1) + 0.15 * stir * s(36, 0);
  const x = -0.03 + 0.12 * down[0] + 0.012 * stir * s(72, 1);
  const roll = 0.10 * s(2, 0.5) + 0.06 * stir * s(18, 0);
  const [sa, sb] = [a * Math.cos(roll) - b * Math.sin(roll), a * Math.sin(roll) + b * Math.cos(roll)];
  const off = 0.585 - 0.27 * size;
  // the lamp: on the far side of it from us, up and down and from side to side
  const l = Math.hypot(eye[1], eye[2]) || 1;
  const w = 0.6 * s(3, 1.9);
  const [ea, eb] = [eye[1] / l, eye[2] / l];
  const [la, lb] = [-(ea * Math.cos(w) - eb * Math.sin(w)), -(ea * Math.sin(w) + eb * Math.cos(w))];
  const up = s(2, 2.3);
  const r = 0.34 - 0.14 * up * up;
  return { lamp: [0.6 * up, la * r, lb * r], pupa: [x, sa * off, sb * off, size], spine: [bend, sa, sb] };
};

const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

/** strands from a thin cord, opening over its upper end; and some that wander between them */
export const makeWeb = (shape: { A: number; B: number; p: number }, radius: number) => {
  const r = random(12);
  const n01 = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(TAU * r());
  const on = (v: V) => [0, 1, 2].map((k) => STANDING[k * 3] * v[0] + STANDING[k * 3 + 1] * v[1] + STANDING[k * 3 + 2] * v[2]) as V;
  const place = (th: number, a: number, lift: number): V => {
    const d: V = [Math.cos(th), Math.sin(th) * Math.cos(a), Math.sin(th) * Math.sin(a)];
    const rho = Math.hypot(d[1], d[2]);
    const w = (1 + 0.05 * d[0]) * (1 - 0.022 * Math.exp(-((d[0] / 0.42) ** 2)));
    const R = ((Math.abs(d[0]) / shape.A) ** shape.p + (rho / (shape.B * w)) ** shape.p) ** (-1 / shape.p) + lift;
    return on([d[0] * R, d[1] * R, d[2] * R]);
  };
  const neckAt: V = [0, 2.25, 0];
  const N = 380;
  const P = 150;
  const data = new Float32Array(N * P * 4);
  for (let i = 0; i < N; i++) {
    const core = i < 130;
    const th = core ? 0.15 + 0.75 * r() : 0.2 + 1.25 * r() ** 0.9;
    const a = r() * TAU;
    const end = place(th, a, 0.006);
    const leaves = neckAt[1] - 0.75 + 1.25 * r() ** 1.5;
    const turn = r() * TAU;
    const thick = 0.004 + 0.017 * Math.sqrt(r());
    const k = Array.from({ length: 12 }, () => r());
    const loose = core ? 0.25 : 0.5 + 1.1 * r() ** 2;
    const cord = 56;
    const twist = (y: number): V => {
      const q = turn + (TOP - y) * 4.2;
      const w = thick * (1 + 1.5 * Math.exp(-((y - leaves) ** 2) * 3));
      return [Math.cos(q) * w + 0.010 * Math.sin(y * 1.9 + 1), y, Math.sin(q) * w + 0.008 * Math.sin(y * 2.3)];
    };
    const b0 = twist(leaves);
    const reach = Math.hypot(...end.map((x, c) => x - b0[c]));
    const b1: V = [b0[0], b0[1] - reach * 0.4, b0[2]];
    const out = end.map((x, c) => x * 1.1 + (b0[c] - x) * 0.2 + (c === 1 ? 0.03 : 0)) as V;
    for (let j = 0; j < P; j++) {
      let p: V;
      if (j < cord) p = twist(6.5 + (leaves - 6.5) * (j / (cord - 1)));
      else {
        const u = (j - cord + 1) / (P - cord);
        p = [0, 1, 2].map((c) => (1 - u) ** 3 * b0[c] + 3 * (1 - u) ** 2 * u * b1[c] + 3 * (1 - u) * u * u * out[c] + u ** 3 * end[c]) as V;
        const amp = loose * Math.sin(Math.PI * u) ** 0.7;
        for (let c = 0; c < 3; c++)
          p[c] += amp * (0.040 * Math.sin(u * reach * 6.0 * (0.7 + 0.6 * k[c]) + k[c + 3] * 40) + 0.020 * Math.sin(u * reach * 14 * (0.7 + 0.6 * k[c + 3]) + k[c + 6] * 40) + 0.009 * Math.sin(u * reach * 31 * (0.8 + 0.4 * k[c + 6]) + k[c + 9] * 60) + 0.003 * Math.sin(u * reach * 70 + k[c] * 50));
      }
      data.set([...p, radius * (core ? 1.25 : 0.85) * (1 - 0.35 * Math.abs((2 * j) / (P - 1) - 1) ** 3)], (i * P + j) * 4);
    }
  }
  void n01;
  return [{ data, n: N, points: P, step: 0.03 }];
};
