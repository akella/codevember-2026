// A tesseract rolling on the floor of 4D space, and its projection to 3D.
//
// The floor is the 3D space y = 0 (x, z and w lie along it). A roll tips the tesseract 90 degrees about
// one of its bottom squares, turning in the plane of y and the direction it rolls in, as a cube tips
// about an edge. Rolls along x and z look like a cube rolling; a roll along w turns it inside out.
//
// It is projected along w from an eye at floor height, `(x, y, z) * D / (eyeW - w)`, so the 4D floor
// lands on the 3D floor and the shape always stands on it.

export type Vec4 = [number, number, number, number];
type Mat4 = number[][];
export type Move = { axis: 0 | 2 | 3; sign: 1 | -1 };

const Y = 1;

export const parseMoves = (s: string): Move[] =>
  s
    .trim()
    .split(/\s+/)
    .map((n) => ({ axis: "xyzw".indexOf(n[1]) as 0 | 2 | 3, sign: n[0] === "-" ? -1 : 1 }));

const identity = (): Mat4 => [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => +(i === j)));
const mul = (a: Mat4, b: Mat4): Mat4 => a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));
const apply = (m: Mat4, v: Vec4): Vec4 => m.map((row) => row.reduce((s, x, k) => s + x * v[k], 0)) as Vec4;

/** turns by theta in the plane of y and `axis`, tipping the top towards `sign * axis` */
const tip = (axis: number, sign: number, theta: number): Mat4 => {
  const m = identity();
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  m[axis][axis] = c;
  m[Y][Y] = c;
  m[axis][Y] = sign * s;
  m[Y][axis] = -sign * s;
  return m;
};

const isIdentity = (m: Mat4) => m.every((row, i) => row.every((v, j) => Math.abs(v - +(i === j)) < 1e-9));

/** how many times the sequence has to repeat before the tesseract is back as it started, turned too */
export const loopRepeats = (moves: Move[]) => {
  let one = identity();
  for (const m of moves) one = mul(tip(m.axis, m.sign, Math.PI / 2), one);
  let p = one;
  let n = 1;
  while (!isIdentity(p) && n < 64) {
    p = mul(one, p);
    n++;
  }
  return n;
};

/**
 * Angle against time for one roll, from rest to rest, as a heavy block tips: a push lifts it over the
 * bottom edge, it slows to nearly nothing at the balance point, then falls faster and faster, lands
 * and rocks back a little. Simulated once as an inverted pendulum about the edge; time runs 0..1.
 */
export const makeProfile = ({ hesitate = 0.3, bounce = 0.25 } = {}) => {
  const quarter = Math.PI / 4;
  // phi is the lean of the centre past the pivot, -45 degrees at rest; gravity pulls it away from 0
  const run = (push: number, record?: number[][]) => {
    let phi = -quarter;
    let w = 0;
    let t = 0;
    const dt = 1e-4;
    const pushTime = 0.6;
    let topSpeed = -1;
    let impacts = 0;
    while (t < 40) {
      const a = Math.sin(phi) + (t < pushTime ? push * Math.sin((Math.PI * t) / pushTime) : 0);
      w += a * dt;
      phi += w * dt;
      t += dt;
      if (topSpeed < 0 && phi >= 0) topSpeed = w;
      if (w <= 0 && phi < 0 && t > pushTime) return { topSpeed: -1, t };
      if (phi >= quarter) {
        phi = quarter;
        impacts++;
        w = -w * bounce;
        if (Math.abs(w) < 0.02 || impacts > 6) {
          record?.push([t, Math.PI / 2]);
          break;
        }
      }
      record?.push([t, phi + quarter]);
    }
    return { topSpeed, t };
  };
  // the push that leaves `hesitate` of the speed it had at the start when it crosses the balance point
  let lo = 0;
  let hi = 4;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const r = run(mid);
    if (r.topSpeed < 0 || r.topSpeed < hesitate * 0.6) lo = mid;
    else hi = mid;
  }
  const samples: number[][] = [];
  run(hi, samples);
  const total = samples[samples.length - 1][0];
  const n = 512;
  const table = new Float32Array(n + 1);
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * total;
    while (j < samples.length - 1 && samples[j + 1][0] < t) j++;
    const [t0, a0] = samples[j];
    const [t1, a1] = samples[Math.min(j + 1, samples.length - 1)];
    table[i] = t1 > t0 ? a0 + ((a1 - a0) * (t - t0)) / (t1 - t0) : a0;
  }
  table[n] = Math.PI / 2;
  return (u: number) => {
    const x = Math.min(1, Math.max(0, u)) * n;
    const i = Math.min(n - 1, Math.floor(x));
    return table[i] + (table[i + 1] - table[i]) * (x - i);
  };
};

/** the 16 corners, index bit k set meaning +1 along original axis k (x, y, z, w) */
export const corner = (i: number): Vec4 => [0, 1, 2, 3].map((k) => ((i >> k) & 1 ? 1 : -1)) as Vec4;

/** edges as corner pairs, with the original axis they run along */
export const EDGES: [number, number, number][] = [];
/** squares as four corners in order, with the bitmask of the two original axes they span */
export const FACES: [number, number, number, number, number][] = [];
for (let i = 0; i < 16; i++)
  for (let b = 0; b < 4; b++) {
    if ((i >> b) & 1) continue;
    EDGES.push([i, i | (1 << b), b]);
    for (let c = b + 1; c < 4; c++) {
      if ((i >> c) & 1) continue;
      FACES.push([i, i | (1 << b), i | (1 << b) | (1 << c), i | (1 << c), (1 << b) | (1 << c)]);
    }
  }

export type Pose = { corners: Vec4[]; centre: Vec4 };

/**
 * Where the tesseract is `time` seconds into the loop. Every roll is replayed from the start, so any
 * moment can be drawn on its own, which keeps exported frames and held stills exact.
 */
export const poseAt = (
  time: number,
  moves: Move[],
  { rollTime, pause, beam, start, profile }: { rollTime: number; pause: number; beam: number; start: [number, number]; profile: (u: number) => number },
): Pose => {
  const period = rollTime + pause;
  const step = Math.max(0, Math.floor(time / period));
  let turn = identity();
  // half size 1, resting a beam's radius up so the beams touch the floor rather than sink into it
  const centre: Vec4 = [start[0], 1 + beam, start[1], 0];
  for (let k = 0; k < step; k++) {
    const m = moves[k % moves.length];
    turn = mul(tip(m.axis, m.sign, Math.PI / 2), turn);
    centre[m.axis] += 2 * m.sign;
  }
  const local = time - step * period;
  const m = moves[step % moves.length];
  const theta = profile(local / rollTime);
  const R = tip(m.axis, m.sign, theta);
  const pivot: Vec4 = [...centre];
  pivot[m.axis] += m.sign;
  pivot[Y] = beam;
  const place = (v: Vec4): Vec4 => {
    const d = apply(R, v.map((x, k) => x - pivot[k]) as Vec4);
    return d.map((x, k) => x + pivot[k]) as Vec4;
  };
  const corners = Array.from({ length: 16 }, (_, i) => place(apply(turn, corner(i)).map((x, k) => x + centre[k]) as Vec4));
  return { corners, centre: place(centre) };
};

/** 4D to 3D: perspective along w from an eye `distance` beyond the centre, at floor height */
export const project = (v: Vec4, eyeW: number, distance: number, beam: number) => {
  const k = distance / Math.max(1e-3, eyeW - v[3]);
  return { x: v[0] * k, y: v[1] * k, z: v[2] * k, r: beam * k };
};
