/**
 * A cocoon torn out of its web by its own weight, worked out once before the page starts.
 *
 * The cocoon is a rigid body on strands that only pull, from a row of places overhead to its upper side. Each
 * has its own length and strength and tires as it is loaded; when one snaps the others take its load. A strand lies
 * on the cocoon from where it is tied up to where it leaves the surface, and pulls from there: as the cocoon tilts,
 * it peels off. What is left of a torn strand, above and below, are loose chains.
 *
 * Everything in the frame of hang.ts: the cocoon's middle at rest is the origin, y up.
 */

export type Shape = { A: number; B: number; p: number };
export type Tear = {
  fps: number;
  frames: number;
  nodes: number;
  /** half strands: the upper halves, then the lower */
  halves: number;
  /** [frames][x y z, quaternion w x y z] */
  body: Float32Array;
  /** [frames][x y z]: the thread's end, off where it would be */
  end: Float32Array;
  /** [halves][frames][nodes][x y z _], thousandths of a unit and a bit: times `step` */
  places: Int16Array;
  step: number;
  /** how long each half is, slack or not */
  length: Float32Array;
  /** when each strand snaps (seconds), and the last of them */
  snaps: Float32Array;
  last: number;
};

const G = 13;
const SUB = 10;
const FPS = 60;
export const TEAR_FPS = 30;
const NODES = 12;
const STRANDS = 140;
const ROPES = 14;
const STEP = 0.0015;

type V = [number, number, number];
const add = (a: V, b: V, s = 1): V => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const unit = (a: V): V => scale(a, 1 / (len(a) || 1));

const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

export type Options = { seconds: number; over: number; wide: number; standing: number[]; seed?: number; tire?: number; lopsided?: number; stiff?: number; kin?: number; dry?: boolean; /** its thread gives and swings: how long above its end, how stiff */ thread?: { length: number; stiff: number; drag: number } };

export const simulate = (shape: Shape, o: Options): Tear => {
  const r = random(o.seed ?? 5);
  const normal = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(6.2831853 * r());
  const { A, B } = shape;

  // ---- the surface: an ellipsoid for the forces, the real one for what is seen
  const onEllipsoid = (d: V): V => scale(d, 1 / Math.sqrt((d[0] / A) ** 2 + (d[1] / B) ** 2 + (d[2] / B) ** 2));
  const real = (d: V, lift: number): V => {
    const rho = Math.hypot(d[1], d[2]) + 1e-9;
    const w = (1 + 0.05 * d[0]) * (1 - 0.022 * Math.exp(-((d[0] / 0.42) ** 2)));
    const R = ((Math.abs(d[0]) / A) ** shape.p + (rho / (B * w)) ** shape.p) ** (-1 / shape.p);
    return scale(d, R + lift);
  };

  // ---- the strands
  // in ropes: those of one are tied near one another, are about as long and as strong, and tear together
  // `side` -1 left, 1 right: where overhead it goes to, and on which flank it is tied; the left is the weaker
  const ropes = Array.from({ length: ROPES }, (_, i) => {
    const side = -1 + (2 * (i + 0.5 + 0.5 * (r() - 0.5))) / ROPES;
    const lopsided = o.lopsided ?? 0.5;
    if (o.wide === 0) {
      // one thread: all round, those low on one flank the strongest
      const round = ((i + 0.6 * (r() - 0.5)) / ROPES) * 6.2831853;
      const th = 0.3 + 1.15 * ((i * 0.618034 + 0.3 * r()) % 1);
      const side = Math.cos(round);
      return { side, over: [0, o.over, 0] as V, th, front: round, loose: 0.07 * r() ** 1.5, strong: Math.exp(0.2 * normal()) * (1 + lopsided * side) * (0.6 + 0.5 * th) };
    }
    return {
      side,
      over: [Math.sign(side) * o.wide, o.over, 0] as V, // the end of one of two threads
      th: 0.3 + 0.8 * Math.abs(side) + 0.25 * r(),
      front: (i % 2 ? 0.9 : -0.9) * (0.25 + 0.9 * r()),
      loose: 0.07 * r() ** 1.5,
      strong: Math.exp(0.22 * normal()) * (1 + lopsided * side),
    };
  });
  const strands = Array.from({ length: STRANDS }, (_, i) => {
    const rope = i % ROPES;
    const own = ropes[rope];
    const th = Math.min(1.6, Math.max(0.12, own.th + 0.13 * normal()));
    // on its flank of the cocoon as it hangs, then in the cocoon's own frame
    const a = own.front + 0.22 * normal();
    const h: V = unit([(o.wide === 0 ? 1 : Math.sign(own.side)) * Math.sin(th) * Math.cos(a), Math.cos(th), Math.sin(th) * Math.sin(a)]);
    const S = o.standing;
    return {
      rope,
      d: [S[0] * h[0] + S[3] * h[1] + S[6] * h[2], S[1] * h[0] + S[4] * h[1] + S[7] * h[2], S[2] * h[0] + S[5] * h[1] + S[8] * h[2]] as V,
      over: add(own.over, [0.014 * normal(), -0.1 + 0.85 * r() ** 1.4, 0.014 * normal()]), // some way up it
      loose: own.loose + 0.05 * r() ** 2,
      strong: own.strong * Math.exp(0.10 * normal()),
      rest: 0,
      tired: 0,
      snap: Infinity,
      cut: 0.45 + 0.5 * r() ** 0.7, // where along itself it tears
      seed: r(),
      bow: [normal(), normal() * 0.4, normal()] as V,
      tension: 0,
      at: 0, // along its way on the surface, where it leaves it
    };
  });

  // ---- the bodies
  let x: V = [0, 0, 0];
  let v: V = [0, 0, 0];
  let w: V = [0, 0, 0];
  // standing: own frame to hanging, as rows
  let q = quatOf(o.standing);
  const inertia: V = [0.17, 0.29, 0.29];

  /** where a strand leaves the surface (own frame), and how much of it lies on it */
  const leave = (s: (typeof strands)[number], anchor: V): [V, number] => {
    const apex = unit(anchor);
    const seen = (u: number) => {
      const p = onEllipsoid(unit(add(scale(s.d, 1 - u), apex, u)));
      const n: V = [p[0] / (A * A), p[1] / (B * B), p[2] / (B * B)];
      return dot(n, sub(anchor, p)) > 0.02;
    };
    let lo = 0;
    if (!seen(0)) {
      let hi = 1;
      for (let k = 0; k < 6; k++) {
        const m = (lo + hi) / 2;
        if (seen(m)) hi = m;
        else lo = m;
      }
      lo = hi;
    }
    s.at = lo;
    const p = onEllipsoid(unit(add(scale(s.d, 1 - lo), apex, lo)));
    return [p, lo > 0 ? len(sub(p, onEllipsoid(s.d))) * 1.04 : 0];
  };
  // the thread's end, off where it would be
  let end: V = [0, 0, 0];
  let ev: V = [0, 0, 0];
  const anchorOf = (s: (typeof strands)[number]): V => (o.thread ? add(s.over, end) : s.over);

  const K = o.stiff ?? 2.4;
  const step = (dt: number, hold: number, tire: number, t: number) => {
    const R = matOf(q);
    const back = (a: V): V => [R[0] * a[0] + R[3] * a[1] + R[6] * a[2], R[1] * a[0] + R[4] * a[1] + R[7] * a[2], R[2] * a[0] + R[5] * a[1] + R[8] * a[2]];
    const out = (a: V): V => [R[0] * a[0] + R[1] * a[1] + R[2] * a[2], R[3] * a[0] + R[4] * a[1] + R[5] * a[2], R[6] * a[0] + R[7] * a[1] + R[8] * a[2]];
    let F: V = [0, -G, 0];
    F = add(F, v, -0.25 - hold);
    let W: V = scale(w, -0.035 - hold * 0.3);
    let E: V = [0, -G * 0.1, 0];
    for (const s of strands) {
      if (s.snap < Infinity) continue;
      const anchor = anchorOf(s);
      const own = back(sub(anchor, x));
      const [p, wrapped] = leave(s, own);
      const arm = out(p);
      const d = sub(anchor, add(x, arm));
      const span = len(d);
      const L = span + wrapped;
      if (s.rest === 0) continue;
      const strain = (L - s.rest) / s.rest;
      if (strain <= 0) {
        s.tension = 0;
        continue;
      }
      const n = scale(d, 1 / span);
      const rel = dot(sub(ev, add(v, cross(w, arm))), n);
      const f = Math.max(0, K * strain * (1 + 1.5 * strain) + 0.09 * rel);
      s.tension = f;
      F = add(F, n, f);
      W = add(W, cross(arm, scale(n, f)));
      E = add(E, n, -f);
      if (tire > 0) {
        s.tired += dt * tire * (strain / (0.15 * s.strong)) ** 4;
        if (s.tired > 1 || strain > 0.9 * s.strong) {
          s.snap = t;
          // and the others of its rope are the worse for it
          for (const k of strands) if (k.rope === s.rope) k.tired += o.kin ?? 0.22;
        }
      }
    }
    if (o.thread) {
      const up = sub([0, o.thread.length, 0], end);
      const l = len(up);
      E = add(add(E, up, Math.max(0, o.thread.stiff * (l - o.thread.length)) / l), ev, -o.thread.drag - hold);
      ev = add(ev, E, dt / 0.14);
      end = add(end, ev, dt);
    }
    v = add(v, F, dt);
    x = add(x, v, dt);
    const wl = back(W);
    const ol = back(w);
    const al: V = [
      (wl[0] - (inertia[2] - inertia[1]) * ol[1] * ol[2]) / inertia[0],
      (wl[1] - (inertia[0] - inertia[2]) * ol[2] * ol[0]) / inertia[1],
      (wl[2] - (inertia[1] - inertia[0]) * ol[0] * ol[1]) / inertia[2],
    ];
    w = add(w, out(al), dt);
    const h = scale(w, dt / 2);
    const [a, b, c, d] = q;
    q = [a - h[0] * b - h[1] * c - h[2] * d, b + h[0] * a + h[1] * d - h[2] * c, c + h[1] * a + h[2] * b - h[0] * d, d + h[2] * a + h[0] * c - h[1] * b];
    const l = Math.hypot(...q);
    q = q.map((z) => z / l) as typeof q;
  };

  // ---- lengths: as it would hang, some with a little to spare; the weak side tires first
  {
    const R = matOf(q);
    const back = (a: V): V => [R[0] * a[0] + R[3] * a[1] + R[6] * a[2], R[1] * a[0] + R[4] * a[1] + R[7] * a[2], R[2] * a[0] + R[5] * a[1] + R[8] * a[2]];
    for (const s of strands) {
      const own = back(anchorOf(s));
      const [p, wrapped] = leave(s, own);
      s.rest = (len(sub(own, p)) + wrapped) * (0.965 + s.loose);
    }
  }
  const dt = 1 / FPS / SUB;
  for (let k = 0; k < 6 * FPS * SUB; k++) step(dt, 3, 0, 0);
  v = [0, 0, 0];
  w = [0, 0, 0];
  ev = [0, 0, 0];

  // ---- the halves as chains
  const every = FPS / TEAR_FPS;
  const frames = Math.round(o.seconds * TEAR_FPS) + 1;
  const halves = STRANDS * 2;
  const body = new Float32Array(frames * 7);
  const ends = new Float32Array(frames * 3);
  const places = new Int16Array(halves * frames * NODES * 4);
  const length = new Float32Array(halves);
  const pulled = new Float32Array(halves); // how long it was when it went
  const P = new Float32Array(halves * NODES * 3);
  const O = new Float32Array(halves * NODES * 3);
  const tieAt: V[] = Array.from({ length: halves }, () => [0, 0, 0]);
  const free = new Uint8Array(STRANDS);

  /** the whole strand as it lies now: from the thread, through the air, on the surface to its tie (world) */
  const way = (s: (typeof strands)[number], R: number[]): V[] => {
    const out = (a: V): V => add(x, [R[0] * a[0] + R[1] * a[1] + R[2] * a[2], R[3] * a[0] + R[4] * a[1] + R[5] * a[2], R[6] * a[0] + R[7] * a[1] + R[8] * a[2]]);
    const back = (a: V): V => [R[0] * a[0] + R[3] * a[1] + R[6] * a[2], R[1] * a[0] + R[4] * a[1] + R[7] * a[2], R[2] * a[0] + R[5] * a[1] + R[8] * a[2]];
    const anchor = anchorOf(s);
    const own = back(sub(anchor, x));
    const apex = unit(own);
    const [p0, wrapped] = leave(s, own);
    const tangent = out(real(unit(p0), 0.006));
    const span = len(sub(anchor, tangent));
    const total = span + wrapped;
    // slack shows: it bows
    const spare = Math.max(0, s.rest / Math.max(total, 1e-6) - 1);
    const bow = Math.sqrt(Math.max(spare, 0)) * 0.45 * span;
    const at = (a: number): V => {
      if (a <= span) {
        const u = a / span;
        const p = add(add(scale(anchor, 1 - u), tangent, u), s.bow, (0.35 * bow + 0.012) * Math.sin(Math.PI * u));
        return p;
      }
      const u = s.at * (1 - (a - span) / Math.max(wrapped, 1e-6));
      return out(real(unit(add(scale(s.d, 1 - u), apex, u)), 0.006 + 0.01 * s.seed));
    };
    // the upper half from the top, the lower from its tie, to where it tears
    const pts: V[] = [];
    for (let k = 0; k < NODES; k++) pts.push(at((k / (NODES - 1)) * s.cut * total));
    for (let k = 0; k < NODES; k++) pts.push(at(total * (1 - (k / (NODES - 1)) * (1 - s.cut))));
    return pts;
  };

  /** p kept outside the cocoon */
  const outside = (p: V, R: number[], lift: number): V => {
    const d = sub(p, x);
    if (dot(d, d) > 1.25) return p;
    const l = len(d) || 1e-6;
    const own = unit([R[0] * d[0] + R[3] * d[1] + R[6] * d[2], R[1] * d[0] + R[4] * d[1] + R[7] * d[2], R[2] * d[0] + R[5] * d[1] + R[8] * d[2]]);
    const at = len(real(own, lift));
    return l < at ? add(x, d, at / l) : p;
  };

  const T = new Float64Array(NODES * 3);
  const chain = (h: number, s: (typeof strands)[number], since: number, sdt: number, R: number[], pin: V) => {
    const upper = h < STRANDS;
    const seg = (pulled[h] / (NODES - 1)) * (1 - (0.06 + 0.22 * s.seed) * Math.min(1, since / 0.5));
    const least = 1.45 * seg;
    const drag = Math.exp(-(upper ? (o.thread ? 4.2 : 2.6) : 3.4) * sdt);
    const at = h * NODES * 3;
    const t = since * 1.3 + s.seed * 40;
    const dd = sdt * sdt;
    for (let k = 0; k < NODES; k++) {
      const i = at + k * 3;
      const a = k / (NODES - 1);
      for (let c = 0; c < 3; c++) {
        const p = P[i + c];
        T[k * 3 + c] = p + (p - O[i + c]) * drag;
        O[i + c] = p;
      }
      // light, and the air is never still
      T[k * 3] += 0.8 * a * Math.sin(t * 1.1 + a * 3) * dd;
      T[k * 3 + 1] -= 5.0 * dd;
      T[k * 3 + 2] += 0.8 * a * Math.cos(t * 0.9 + a * 4) * dd;
    }
    for (let it = 0; it < 5; it++) {
      T[0] = pin[0];
      T[1] = pin[1];
      T[2] = pin[2];
      for (let k = 0; k < NODES - 1; k++) {
        const i = k * 3;
        const dx = T[i + 3] - T[i];
        const dy = T[i + 4] - T[i + 1];
        const dz = T[i + 5] - T[i + 2];
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        if (l > seg) {
          const c = (l - seg) / l;
          const wa = k === 0 ? 0 : 0.5 * c;
          const wb = c - wa;
          T[i] += dx * wa;
          T[i + 1] += dy * wa;
          T[i + 2] += dz * wa;
          T[i + 3] -= dx * wb;
          T[i + 4] -= dy * wb;
          T[i + 5] -= dz * wb;
        }
      }
      // it doesn't fold
      for (let k = 0; k < NODES - 2; k++) {
        const i = k * 3;
        const dx = T[i + 6] - T[i];
        const dy = T[i + 7] - T[i + 1];
        const dz = T[i + 8] - T[i + 2];
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        if (l < least) {
          const c = ((l - least) / l) * 0.16;
          if (k > 0) {
            T[i] += dx * c;
            T[i + 1] += dy * c;
            T[i + 2] += dz * c;
          }
          T[i + 6] -= dx * c;
          T[i + 7] -= dy * c;
          T[i + 8] -= dz * c;
        }
      }
    }
    const most = (o.thread ? 9 : 22) * sdt;
    for (let k = 1; k < NODES; k++) {
      const i = at + k * 3;
      let [px, py, pz] = [T[k * 3], T[k * 3 + 1], T[k * 3 + 2]];
      const near = (px - x[0]) ** 2 + (py - x[1]) ** 2 + (pz - x[2]) ** 2;
      if (near < 1.25) {
        const out = outside([px, py, pz], R, 0.008 + 0.012 * s.seed);
        if (out[0] !== px || out[1] !== py) {
          // it clings to what it touches
          for (let c = 0; c < 3; c++) O[i + c] += (out[c] - O[i + c]) * 0.25;
          [px, py, pz] = out;
        }
      }
      // no whip faster than this
      const mx = px - O[i];
      const my = py - O[i + 1];
      const mz = pz - O[i + 2];
      const l = Math.sqrt(mx * mx + my * my + mz * mz);
      const f = l > most ? most / l : 1;
      P[i] = O[i] + mx * f;
      P[i + 1] = O[i + 1] + my * f;
      P[i + 2] = O[i + 2] + mz * f;
    }
    P[at] = pin[0];
    P[at + 1] = pin[1];
    P[at + 2] = pin[2];
  };

  const CHAIN = 3;
  for (let f = 0; f <= (frames - 1) * every; f++) {
    const R = matOf(q);
    const Rn = (a: V): V => add(x, [R[0] * a[0] + R[1] * a[1] + R[2] * a[2], R[3] * a[0] + R[4] * a[1] + R[5] * a[2], R[6] * a[0] + R[7] * a[1] + R[8] * a[2]]);
    // what still holds lies where it must; what has just gone starts from there
    if (!o.dry) strands.forEach((s, i) => {
      if (free[i] || (f % every !== 0 && s.snap === Infinity)) return;
      const pts = way(s, R);
      for (let k = 0; k < NODES; k++) {
        const u = pts[k];
        const l = pts[NODES + k];
        const a = (i * NODES + k) * 3;
        const b = ((STRANDS + i) * NODES + k) * 3;
        for (let c = 0; c < 3; c++) {
          O[a + c] = u[c];
          O[b + c] = l[c];
          P[a + c] = u[c];
          P[b + c] = l[c];
        }
      }
      if (s.snap < Infinity) {
        free[i] = 1;
        for (const h of [i, STRANDS + i]) {
          let L = 0;
          for (let k = 1; k < NODES; k++) L += Math.hypot(...[0, 1, 2].map((c) => P[(h * NODES + k) * 3 + c] - P[(h * NODES + k - 1) * 3 + c]));
          pulled[h] = L;
          // the pull lets go: its end springs back along it
          for (let k = 1; k < NODES; k++)
            for (let c = 0; c < 3; c++) {
              const j = (h * NODES + k) * 3 + c;
              const toward = P[(h * NODES + k - 1) * 3 + c] - P[j];
              O[j] = P[j] - (P[j] - O[j]) * 0.25 - ((toward * k) / NODES) * Math.min(1, s.tension * 1.2) * (o.thread ? 0.15 : 0.5);
            }
        }
        const d = sub([P[(STRANDS + i) * NODES * 3], P[(STRANDS + i) * NODES * 3 + 1], P[(STRANDS + i) * NODES * 3 + 2]], x);
        tieAt[STRANDS + i] = [R[0] * d[0] + R[3] * d[1] + R[6] * d[2], R[1] * d[0] + R[4] * d[1] + R[7] * d[2], R[2] * d[0] + R[5] * d[1] + R[8] * d[2]];
      }
    });
    if (f % every === 0) {
      const g = f / every;
      body.set([...x, ...q], g * 7);
      ends.set(end, g * 3);
      for (let h = 0; h < halves; h++)
        for (let k = 0; k < NODES; k++)
          for (let c = 0; c < 3; c++) places[((h * frames + g) * NODES + k) * 4 + c] = Math.max(-32767, Math.min(32767, Math.round(P[(h * NODES + k) * 3 + c] / STEP)));
    }
    for (let k = 0; k < SUB; k++) step(dt, 0, o.tire ?? 1, (f + k / SUB) / FPS);
    const R1 = matOf(q);
    const R1n = (a: V): V => add(x, [R1[0] * a[0] + R1[1] * a[1] + R1[2] * a[2], R1[3] * a[0] + R1[4] * a[1] + R1[5] * a[2], R1[6] * a[0] + R1[7] * a[1] + R1[8] * a[2]]);
    if (!o.dry) strands.forEach((s, i) => {
      if (!free[i]) return;
      for (let k = 0; k < CHAIN; k++)
        for (const h of [i, STRANDS + i]) chain(h, s, (f + (k + 1) / CHAIN) / FPS - s.snap, 1 / FPS / CHAIN, R1, h === i ? anchorOf(s) : R1n(tieAt[h]));
    });
  }
  for (let h = 0; h < halves; h++)
    for (let k = 1; k < NODES; k++) length[h] += Math.hypot(...[0, 1, 2].map((c) => (places[(h * frames * NODES + k) * 4 + c] - places[(h * frames * NODES + k - 1) * 4 + c]) * STEP));
  return { fps: TEAR_FPS, frames, nodes: NODES, halves, body, end: ends, places, step: STEP, length, snaps: Float32Array.from(strands, (s) => s.snap), last: Math.max(...strands.map((s) => s.snap)) };
};

export const matOf = ([w, x, y, z]: number[]) => [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];

function quatOf(m: number[]): [number, number, number, number] {
  const t = m[0] + m[4] + m[8];
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    return [s / 4, (m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s];
  }
  if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    return [(m[7] - m[5]) / s, s / 4, (m[1] + m[3]) / s, (m[2] + m[6]) / s];
  }
  if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    return [(m[2] - m[6]) / s, (m[1] + m[3]) / s, s / 4, (m[5] + m[7]) / s];
  }
  const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
  return [(m[3] - m[1]) / s, (m[2] + m[6]) / s, (m[5] + m[7]) / s, s / 4];
}
