/**
 * A cluster of three cocoons in a net, hung from a handful of taut cords, as in a photograph on grey. All of the silk
 * between them is made here: the cords, a net of crossing zigzags laid over the cluster's hull, and what strays off it.
 */
export type Pose = { R: number[]; t: number[] };
export type Place = { id: number; at: [number, number, number]; axis: [number, number, number]; face: number };

/** where they hang: middle, long axis, which way round it faces */
export const PLACES: Place[] = [
  { id: 0, at: [-0.63, 0.62, 0.0], axis: [0.26, 0.95, 0.1], face: 0.4 },
  { id: 2, at: [0.79, 0.16, -0.02], axis: [-0.34, 0.92, 0.12], face: 2.2 },
  { id: 1, at: [-0.12, -1.02, 0.42], axis: [0.47, 0.87, 0.02], face: 4.0 },
];
const TOP = 6.2;
/** where the cords come together */
const HEAD: [number, number, number] = [-0.02, 4.9, 0];

type V = [number, number, number];
const add = (a: V, b: V, s = 1): V => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(...a);
const unit = (a: V): V => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mixV = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

/** from a cocoon's own frame (x its long axis), as rows */
export const standing = ({ axis, face }: Place) => {
  const x = unit(axis);
  const y0 = unit(cross([0, 0, 1], x));
  const z0 = cross(x, y0);
  const [c, s] = [Math.cos(face), Math.sin(face)];
  const y = add([y0[0] * c, y0[1] * c, y0[2] * c], z0, s);
  const z = cross(x, y);
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
};

export type Shape = { A: number; B: number };

export const makeWeb = (shapes: Shape[], radius: number) => {
  const r = random(21);
  const n01 = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(6.2831853 * r());
  const frames = PLACES.map(standing);
  // ---- distances: to a cocoon; to the net's hull
  const toCocoon = (k: number, p: V) => {
    const d = sub(p, PLACES[k].at);
    const M = frames[k];
    const q: V = [M[0] * d[0] + M[3] * d[1] + M[6] * d[2], M[1] * d[0] + M[4] * d[1] + M[7] * d[2], M[2] * d[0] + M[5] * d[1] + M[8] * d[2]];
    const { A, B } = shapes[PLACES[k].id];
    const g: V = [q[0] / A, q[1] / B, q[2] / B];
    const l = len(g);
    return (l * (l - 1)) / (len([g[0] / A, g[1] / B, g[2] / B]) || 1e-6);
  };
  const smin = (a: number, b: number, k: number) => {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * h * k * (1 / 6);
  };
  const toCone = (p: V) => {
    // narrow at the cords' head, wide over the cocoons' shoulders
    const t = Math.min(1, Math.max(0, (3.3 - p[1]) / 2.5));
    const c: V = [0.02 + 0.04 * t, 3.3 - 2.5 * t, 0];
    return Math.hypot(p[0] - c[0], (p[1] - c[1]) * 0.55, p[2] - c[2]) - (0.13 + 0.80 * t * t * 0.85);
  };
  const hull = (p: V) => {
    const a = toCocoon(0, p);
    const b = toCocoon(1, p);
    const c = toCocoon(2, p);
    return smin(smin(smin(a, b, 0.75), c, 0.75), toCone(p), 0.5);
  };
  const solid = (p: V) => Math.min(toCocoon(0, p), toCocoon(1, p), toCocoon(2, p));
  const gradient = (f: (p: V) => number, p: V): V => {
    const e = 0.01;
    return unit([f([p[0] + e, p[1], p[2]]) - f([p[0] - e, p[1], p[2]]), f([p[0], p[1] + e, p[2]]) - f([p[0], p[1] - e, p[2]]), f([p[0], p[1], p[2] + e]) - f([p[0], p[1], p[2] - e])]);
  };
  const clear = (p: V, lift: number): V => {
    for (let k = 0; k < 3; k++) {
      const d = solid(p);
      if (d >= lift) break;
      p = add(p, gradient(solid, p), (lift - d) * 1.02);
    }
    return p;
  };
  /** the hull, seen from the cluster's axis at height y, round angle a */
  const onHull = (a: number, y: number, lift: number): V | undefined => {
    const axis: V = [0.03, y, 0.08];
    const d: V = [Math.sin(a), 0, Math.cos(a)];
    let t = 3;
    for (let k = 0; k < 60; k++) {
      const h = hull(add(axis, d, t)) - lift;
      if (h < 0.002 || t < 0.03) break;
      t -= h * 0.8;
    }
    const p = add(axis, d, t);
    return Math.abs(hull(p) - lift) < 0.04 && t > 0.1 ? p : undefined;
  };
  // smooth wander over the surface, so that a net isn't a grid
  const waves = Array.from({ length: 10 }, () => [(0.8 + 2.6 * r()) * (r() < 0.5 ? 1 : -1), 0.8 + 2.8 * r(), r() * 6.28, r() * 6.28]);
  const drift = (a: number, y: number, k: number) => waves.reduce((s, [f, g, p, q], i) => s + Math.sin(Math.round(f * 2) * a + g * y * 1.7 + p + k * (q + i)), 0) / 4;

  const strands: { p: V[]; w: number; ends: number }[] = [];
  // ---- the net: pairs of zigzags that meet and part
  const LAYERS = [
    { around: 84, cell: 0.082, lift: 0.008, off: 0, w: 1.5, gaps: 0.25 },
    { around: 64, cell: 0.105, lift: 0.035, off: 0.5, w: 1.35, gaps: 0.5 },
    { around: 46, cell: 0.15, lift: 0.10, off: 0.2, w: 1.2, gaps: 0.9 },
  ];
  LAYERS.forEach((L, li) => {
    for (let i = 0; i < L.around * 2; i++) {
      const side = i % 2 ? 1 : -1;
      const col = Math.floor(i / 2) + (side > 0 ? 0 : 0);
      const y0 = -2.2;
      const y1 = 1.15 + 0.7 * r() ** 2;
      const per = 3;
      const rows = Math.round((y1 - y0) / L.cell);
      let run: V[] = [];
      const flush = () => {
        if (run.length > 6) strands.push({ p: run, w: L.w * (0.8 + 0.4 * r()), ends: 0.3 });
        run = [];
      };
      let hole = 0;
      for (let k = 0; k <= rows * per; k++) {
        const y = y0 + ((y1 - y0) * k) / (rows * per);
        // in and out, rounded: two of them make a row of cells
        const s = Math.sin((Math.PI * k) / per + (col % 2 ? 0 : 0));
        const zig = Math.sign(s) * Math.abs(s) ** 0.7;
        const a0 = ((col + L.off + side * 0.25 + side * 0.25 * zig) / L.around) * 6.2831853;
        const a = a0 + 0.13 * drift(a0, y, li) + 0.022 * n01();
        const yy = y + 0.07 * drift(a0 + 2, y, li + 5) + 0.022 * n01();
        if (hole > 0) hole--;
        else if (r() < L.gaps / 22) {
          hole = 4 + Math.floor(r() * 16);
          flush();
        }
        if (hole > 0) continue;
        const up = smooth(1.3, 2.6, yy);
        const on = onHull(a, yy, L.lift + 0.03 * drift(a, yy, li + 9) * (0.4 + li) + 0.05 * up);
        if (!on) {
          flush();
          continue;
        }
        run.push(clear(on, 0.006 + 0.6 * L.lift * r()));
      }
      flush();
    }
  });
  const netEnd = strands.length;

  // ---- the cords, and the strands they open into
  const feet: { p: V; spread: number; n: number }[] = [];
  const foot = (k: number, dir: V, spread: number, n: number) => {
    // a place on a cocoon's upper end
    let p = add(PLACES[k].at, unit(dir), 1.6);
    for (let j = 0; j < 40; j++) p = add(p, unit(sub(PLACES[k].at, p)), Math.max(0, toCocoon(k, p)) * 0.7);
    feet.push({ p, spread, n });
  };
  foot(0, [-0.75, 1, 0.35], 0.22, 26);
  foot(0, [-0.25, 1, 0.5], 0.18, 18);
  foot(0, [0.45, 0.9, 0.2], 0.2, 16);
  foot(1, [-0.5, 1, 0.5], 0.22, 20);
  foot(1, [0.5, 0.9, 0.3], 0.26, 24);
  foot(1, [0.1, 1, -0.5], 0.22, 14);
  foot(0, [0, 1, -0.6], 0.25, 12);
  feet.forEach(({ p: f, spread, n }, c) => {
    const a = (c / feet.length) * 6.28;
    const at = add(HEAD, [f[0] * 0.13 + 0.04 * Math.cos(a), 0, f[2] * 0.12 + 0.04 * Math.sin(a)]);
    for (let i = 0; i < n; i++) {
      const core = i < n * 0.45;
      const j = 0.4 + 0.6 * r();
      const end = clear(add(f, [n01() * spread * (core ? 0.22 : 1), n01() * spread * 0.4, n01() * spread * (core ? 0.22 : 1)]), 0.004);
      const open = core ? 0.06 + 0.1 * r() : 0.10 + 0.42 * r();
      const tw = r() * 6.28;
      const th = 0.004 + 0.012 * Math.sqrt(r());
      const P: V[] = [];
      const N = 130;
      const wob = [r() * 40, r() * 40, r() * 40, 0.7 + 0.6 * r(), 0.7 + 0.6 * r()];
      for (let k = 0; k < N; k++) {
        const u = k / (N - 1);
        const down = u * 1.0;
        const top: V = [HEAD[0] + (at[0] - HEAD[0]) * 0.5, TOP, at[2] * 0.5];
        let p: V;
        if (down < 0.3) p = mixV(top, at, down / 0.3);
        else {
          const t = (down - 0.3) / 0.7;
          // nearly straight: it is taut; some hang slack and wander
          p = mixV(at, f, t);
          p = add(p, sub(end, f), smooth(1 - open, 1, t));
          p = add(p, [Math.sin(Math.PI * t) * 0.05 * Math.cos(a), -0.10 * Math.sin(Math.PI * t) * (core ? 0.1 : 1), Math.sin(Math.PI * t) * 0.05 * Math.sin(a)]);
        }
        const loose = core ? 0.15 : 1;
        const s = Math.sin(Math.PI * Math.min(1, down)) ** 0.8;
        const L = len(sub(f, at));
        p = add(p, [
          th * Math.cos(tw + down * 34) * (1 - 0.5 * smooth(0.6, 1, down)) + loose * s * (0.030 * Math.sin(down * L * 3.1 * wob[3] + wob[0]) + 0.012 * Math.sin(down * L * 9 * wob[4] + wob[1]) + 0.005 * Math.sin(down * L * 24 + wob[2])),
          0,
          th * Math.sin(tw + down * 34) * (1 - 0.5 * smooth(0.6, 1, down)) + loose * s * (0.030 * Math.sin(down * L * 3.3 * wob[4] + wob[1]) + 0.012 * Math.sin(down * L * 8 * wob[3] + wob[2]) + 0.005 * Math.sin(down * L * 22 + wob[0])),
        ]);
        P.push(down > 0.5 ? clear(p, 0.004 + 0.01 * j) : p);
      }
      strands.push({ p: P, w: core ? 2.0 : 1.2, ends: 0.2 });
    }
  });

  // ---- the veil: strands that wander between the cords, and stray ends
  for (let i = 0; i < 1150; i++) {
    const a = r() * 6.28;
    const high = i < 430;
    const p0 = onHull(a, high ? 0.8 + 2.2 * r() ** 1.2 : -1.9 + 3.0 * r(), high ? 0.05 - 0.35 * r() : 0.02 + 0.10 * r() ** 2);
    if (!p0) continue;
    let p = p0;
    const want = hull(p0);
    let h: V = unit([n01() * 0.7, (r() < 0.5 ? 1 : -1) * (high ? 1.6 : 0.6), n01() * 0.7]);
    const way = h;
    const P: V[] = [];
    const L = (high ? 0.7 : 0.4) + 1.1 * r();
    const N = 100;
    const beat = 5 + 4 * r();
    let [sx, sz] = [r() * 40, r() * 40];
    for (let k = 0; k < N; k++) {
      P.push(p);
      sx += ((L / N) * 6.28 * beat) / 1.2 * (0.6 + 0.8 * r());
      sz += ((L / N) * 6.28 * beat) / 1.0 * (0.6 + 0.8 * r());
      h = unit(add(add(h, [0.30 * Math.sin(sx), 0.18 * Math.sin(sz + 1), 0.30 * Math.sin(sz)]), way, high ? 0.13 : 0.05));
      h = unit(add(h, gradient(hull, p), -1.6 * Math.max(-0.3, Math.min(0.3, hull(p) - want))));
      p = clear(add(p, h, L / N), 0.006);
    }
    strands.push({ p: P, w: 0.65 + 0.5 * r(), ends: 0.6 });
  }
  for (let i = 0; i < 420; i++) {
    const a = r() * 6.28;
    const y0 = -2.2 + 3.9 * r();
    const p0 = onHull(a, y0, 0.015);
    if (!p0) continue;
    const out = gradient(hull, p0);
    let h = unit(add(add(unit([n01(), n01() - 0.5, n01()]), out, 0.9 * r()), [0, -0.3, 0]));
    let p = p0;
    const P: V[] = [];
    const N = 60;
    const L = 0.10 + 0.85 * r() ** 2.4;
    let [sx, sy, sz] = [r() * 40, r() * 40, r() * 40];
    for (let k = 0; k < N; k++) {
      P.push(p);
      sx += 0.25 * r() + 0.08;
      sy += 0.25 * r() + 0.08;
      sz += 0.25 * r() + 0.08;
      h = unit(add(h, [0.09 * Math.sin(sx), 0.09 * Math.sin(sy) - 0.012, 0.09 * Math.sin(sz)]));
      p = clear(add(p, h, L / N), 0.005);
    }
    strands.push({ p: P, w: 0.7, ends: 1 });
  }

  // ---- as the page wants them: so many points each
  const pack = (list: typeof strands, points: number) => {
    const data = new Float32Array(list.length * points * 4);
    let step = 0;
    list.forEach(({ p, w, ends }, i) => {
      const cum = [0];
      for (let k = 1; k < p.length; k++) cum.push(cum[k - 1] + len(sub(p[k], p[k - 1])));
      const total = cum[cum.length - 1];
      step += total / (points - 1) / list.length;
      let k = 0;
      for (let j = 0; j < points; j++) {
        const s = (total * j) / (points - 1);
        while (k < p.length - 2 && cum[k + 1] < s) k++;
        const t = Math.min(1, Math.max(0, (s - cum[k]) / Math.max(cum[k + 1] - cum[k], 1e-6)));
        const at = mixV(p[k], p[k + 1], t);
        const e = Math.abs((2 * j) / (points - 1) - 1) ** 3;
        data.set([...at, radius * w * (1 - (0.35 + 0.5 * ends) * e)], (i * points + j) * 4);
      }
    });
    return { data, n: list.length, points, step };
  };
  // long and short runs apart, so that short ones aren't given as many points as long ones
  const net = strands.slice(0, netEnd);
  return [pack(net.filter((s) => s.p.length > 60), 130), pack(net.filter((s) => s.p.length <= 60 && s.p.length > 20), 56), pack(net.filter((s) => s.p.length <= 20), 22), pack(strands.slice(netEnd), 110)];
};

/** the whole cluster turns and sways a little on its cords */
export const clusterAt = (t: number, much: number): Pose => {
  const two = Math.PI * 2;
  const spin = much * 0.38 * Math.sin(two * t);
  const [ax, az] = [much * 0.012 * Math.sin(two * 2 * t + 0.7), much * 0.016 * Math.sin(two * t + 2.1)];
  const mul = (a: number[], b: number[]) => {
    const o: number[] = [];
    for (let i = 0; i < 3; i++) for (let c = 0; c < 3; c++) o.push(a[i * 3] * b[c] + a[i * 3 + 1] * b[3 + c] + a[i * 3 + 2] * b[6 + c]);
    return o;
  };
  const R = mul(mul([1, 0, 0, 0, Math.cos(ax), -Math.sin(ax), 0, Math.sin(ax), Math.cos(ax)], [Math.cos(az), -Math.sin(az), 0, Math.sin(az), Math.cos(az), 0, 0, 0, 1]), [Math.cos(spin), 0, Math.sin(spin), 0, 1, 0, -Math.sin(spin), 0, Math.cos(spin)]);
  const pivot: V = [0, TOP, 0];
  return { R, t: [0, 1, 2].map((k) => pivot[k] - (R[k * 3] * pivot[0] + R[k * 3 + 1] * pivot[1] + R[k * 3 + 2] * pivot[2])) };
};
