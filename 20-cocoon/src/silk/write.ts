/**
 * The word "cocoon" written with one thread: c, n and the way between are silk, the three o's are cocoons it winds on.
 * Every so often the thread is drawn taut and the letters go; let go, it falls back into them.
 */
export type Pose = { R: number[]; t: number[] };
type V = [number, number, number];

/** where the o's hang: middle and lean, and which cocoon */
export const PLACES = [
  { id: 0, at: [-2.62, 0.0, 0] as V, lean: 0.16, face: 0.4 },
  { id: 2, at: [0.62, -0.02, 0.05] as V, lean: -0.12, face: 2.2 },
  { id: 1, at: [2.12, 0.03, -0.05] as V, lean: 0.1, face: 4.0 },
];
export const SAMPLES = 1024;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// the pen's way: points it goes through, as a Catmull-Rom curve. [x, y, z]
const c = (x: number): V[] => [
  [x + 0.52, 0.38, 0.05],
  [x + 0.22, 0.83, 0.03],
  [x - 0.25, 0.78, 0],
  [x - 0.56, 0.22, 0],
  [x - 0.52, -0.42, 0],
  [x - 0.12, -0.88, 0],
  [x + 0.38, -0.72, 0.03],
];
const round = (x: number, y: number, lean: number): V[] => {
  // once and a half round an o: over its middle, behind, over again
  const out: V[] = [];
  for (let k = 0; k <= 12; k++) {
    const a = -1.9 + (k / 12) * Math.PI * 3.0;
    const h = -0.42 + 0.84 * (k / 12);
    const r = 0.665 * Math.sqrt(Math.max(0.1, 1 - (h * 0.98) ** 2)) + 0.02;
    const [px, pz] = [r * Math.sin(a), r * Math.cos(a)];
    out.push([x + px * Math.cos(lean) - h * Math.sin(lean), y + h * Math.cos(lean) + px * Math.sin(lean), pz]);
  }
  return out;
};
const n = (x: number): V[] => [
  [x - 0.62, 0.55, 0.05],
  [x - 0.48, 0.1, 0.03],
  [x - 0.47, -0.8, 0],
  [x - 0.44, -0.2, 0.04],
  [x - 0.2, 0.62, 0.05],
  [x + 0.2, 0.75, 0.02],
  [x + 0.44, 0.3, 0],
  [x + 0.46, -0.5, 0],
  [x + 0.6, -0.84, 0],
];
const [O1, O2, O3] = PLACES;
const WORD: V[] = [
  [-14, 2.9, 0],
  [-9, 2.0, 0],
  [-6.0, 1.35, 0],
  [-4.5, 1.0, 0.05],
  ...c(-4.28),
  [-3.55, -0.5, 0.2],
  ...round(O1.at[0], O1.at[1], O1.lean),
  [-1.75, 0.75, 0.12],
  ...c(-1.0),
  [-0.2, -0.5, 0.2],
  ...round(O2.at[0], O2.at[1], O2.lean),
  [1.38, 0.3, 0.3],
  ...round(O3.at[0], O3.at[1], O3.lean),
  [2.98, 0.75, 0.1],
  ...n(3.72),
  [4.9, -0.5, 0.03],
  [6.4, 0.7, 0],
  [9, 1.9, 0],
  [14, 2.9, 0],
];

/** the thread as written and as drawn taut: places by how far along (w: 1 where it lies on a cocoon) */
export const paths = () => {
  const N = 4000;
  const raw: V[] = [];
  const on: number[] = [];
  const at = (i: number) => WORD[Math.min(WORD.length - 1, Math.max(0, i))];
  for (let k = 0; k <= N; k++) {
    const x = (k / N) * (WORD.length - 1);
    const i = Math.min(Math.floor(x), WORD.length - 2);
    const t = x - i;
    const [a, b, d, e] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    raw.push([0, 1, 2].map((q) => b[q] + 0.5 * t * (d[q] - a[q] + t * (2 * a[q] - 5 * b[q] + 4 * d[q] - e[q] + t * (3 * (b[q] - d[q]) + e[q] - a[q])))) as V);
  }
  const cum = [0];
  for (let k = 1; k <= N; k++) cum.push(cum[k - 1] + Math.hypot(...[0, 1, 2].map((q) => raw[k][q] - raw[k - 1][q])));
  const total = cum[N];
  const word = new Float32Array(SAMPLES * 4);
  let k = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const want = (total * s) / (SAMPLES - 1);
    while (k < N - 1 && cum[k + 1] < want) k++;
    const t = (want - cum[k]) / Math.max(cum[k + 1] - cum[k], 1e-6);
    const p = [0, 1, 2].map((q) => raw[k][q] * (1 - t) + raw[k + 1][q] * t);
    // on a cocoon: near one of them
    let w = 0;
    for (const o of PLACES) {
      const d = [p[0] - o.at[0], p[1] - o.at[1], p[2] - o.at[2]];
      w = Math.max(w, 1 - smooth(0.02, 0.30, Math.abs(Math.hypot(d[0] / 0.67, d[1] / 1.0, d[2] / 0.67) - 1)) * 1);
    }
    word.set([...p, w], s * 4);
  }
  // taut: a line that sags a little, hitched once about each o's back
  const taut = new Float32Array(SAMPLES * 4);
  // what of the word's length lies on the o's stays there; the letters' slack runs out at both ends
  let run = 0;
  const free: number[] = [];
  for (let s = 0; s < SAMPLES; s++) {
    free.push(run);
    run += 1 - smooth(0.3, 0.8, word[s * 4 + 3]);
  }
  const marks = PLACES.map((o) => {
    let best = 0;
    let d = 1e9;
    for (let s = 0; s < SAMPLES; s++) {
      const e = Math.hypot(word[s * 4] - o.at[0], word[s * 4 + 1] - o.at[1]);
      if (word[s * 4 + 3] > 0.8 && e < d) [best, d] = [s, e];
    }
    return best;
  });
  for (let s = 0; s < SAMPLES; s++) {
    // between the marks evenly along x
    const M = [0, ...marks, SAMPLES - 1];
    const X = [-19, ...PLACES.map((o) => o.at[0] * 1.02), 19];
    let j = 0;
    while (j < M.length - 2 && s > M[j + 1]) j++;
    const f = (free[s] - free[M[j]]) / Math.max(1e-6, free[M[j + 1]] - free[M[j]]);
    const x = X[j] + (X[j + 1] - X[j]) * Math.min(1, Math.max(0, f));
    const w = word[s * 4 + 3];
    const y = 0.10 + 0.004 * x * x;
    taut.set([x + (word[s * 4] - x) * smooth(0.4, 0.9, w), y + (word[s * 4 + 1] - y) * smooth(0.4, 0.9, w), word[s * 4 + 2] * w, w], s * 4);
  }
  return { word, taut, total };
};

/** 0 written, 1 drawn taut; and how much it trembles */
export const pull = (t: number) => {
  const u = ((t % 1) + 1) % 1;
  const up = smooth(0.36, 0.46, u);
  // let go, it springs back past the word a little
  const s = Math.max(0, (u - 0.6) * 16);
  const back = u < 0.6 ? 1 : Math.exp(-0.85 * s) * Math.cos(1.9 * s) * (1 - smooth(0.9, 1, u));
  return { tension: up * back, hum: smooth(0.43, 0.47, u) * Math.exp(-Math.max(0, u - 0.46) * 16) };
};

export const standing = ({ lean, face }: (typeof PLACES)[number]) => {
  const [cl, sl, cf, sf] = [Math.cos(lean), Math.sin(lean), Math.cos(face), Math.sin(face)];
  // own x up, leant in the picture's plane; turned about itself
  const x: V = [-sl, cl, 0];
  const y: V = [cl * cf, sl * cf, sf];
  const z: V = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
};
/** the o's: turned by the thread as it runs off them, bobbing on it */
export const poseOf = (i: number, t: number, sway: number): Pose => {
  const { tension } = pull(t);
  const o = PLACES[i];
  const p = { ...o, face: o.face + tension * (i % 2 ? -1 : 1) * 1.9 + sway * 0.1 * Math.sin(t * 6.2831853 + i * 2), lean: o.lean * (1 - 0.8 * tension) + sway * 0.03 * Math.sin(t * 6.2831853 * 2 + i) };
  return { R: standing(p), t: [o.at[0], o.at[1] + 0.06 * tension + sway * 0.03 * Math.sin(t * 6.2831853 + i * 1.7), o.at[2]] };
};
