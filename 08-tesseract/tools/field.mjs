// CPU copy of map() in src/trace.wgsl, for checking the field and the dive path without a GPU.
// node tools/field.mjs x y z [eps]
export function makeField({ s = 0.5, w = 0.015, diag = 0.7, outer = 4, fade = 1, lodBias = 1, deepest = 24, margin = 15, walls = true } = {}) {
  const A = (1 + s) / (1 - s);
  const B = (-2 * s) / (1 - s);
  const smoothstep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const smin = (a, b, k) => {
    const h = Math.max(k - Math.abs(a - b), 0) / Math.max(k, 1e-9);
    return Math.min(a, b) - h * h * k * 0.25;
  };
  // column-major 3x3 as [c0, c1, c2], each [x, y, z]
  const mul = (m, v) => [0, 1, 2].map((r) => m[0][r] * v[0] + m[1][r] * v[1] + m[2][r] * v[2]);
  const det = (m) => {
    const [a, b, c] = m;
    return a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
  };
  const len = (v) => Math.hypot(...v);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const beam = (off, dir, inside, sg, ji) => {
    const d = mul(ji, off.map((o, k) => o * sg[k]));
    if (!inside) return len(d);
    const b = mul(ji, dir.map((o, k) => o * sg[k]));
    const f = dot(d, b) / dot(b, b);
    return len(d.map((x, k) => x - b[k] * f));
  };
  const cubeEdges = (a, h) => {
    const e = a.map((x) => x - h);
    const c = e.map((x) => Math.max(x, 0));
    return Math.min(len([c[0], e[1], e[2]]), len([e[0], c[1], e[2]]), len([e[0], e[1], c[2]]));
  };

  return function map(p, eps) {
    if (!Number.isFinite(eps)) throw new Error('eps');
    const lod = eps * lodBias;
    const mg = eps * margin;
    let res = { d: 1e6, mat: 0, levels: 0 };
    let steps = 0;
    const m0 = Math.max(...p.map(Math.abs));
    const L = Math.min(40, Math.max(-outer, Math.floor(Math.log(Math.max(m0, 1e-30)) / Math.log(s))));
    const isRoot = L < -outer + 0.5;
    const size = Math.pow(s, L);
    let dr = 1 / size;
    let ji = [[size, 0, 0], [0, size, 0], [0, 0, size]];
    let q = p.map((x) => x * dr);
    let fd = isRoot ? fade : 1;
    const mq = m0 * dr;
    const wo = (w / s) * fd * size;
    if (2 * wo > lod * 0.5) res.d = cubeEdges(q.map(Math.abs), 1) * size - wo * smoothstep(0.5 * lod, lod, 2 * wo);
    if (mq > 1) {
      res.d = Math.min(res.d, (mq - 1) * size + mg);
      return res;
    }
    let bound = (1 - mq) * size + mg;
    for (let i = 0; i < deepest; i++) {
      res.levels++;
      const a = q.map(Math.abs);
      const m = Math.max(...a);
      const rho = 1 / dr;
      const wf = w * rho * (i === 0 && isRoot ? 1 : fd);
      const wdi = w * diag * rho * fd;
      if (2 * Math.max(wf, wdi) < 0.5 * lod) break;
      const sg = q.map((x) => (x >= 0 ? 1 : -1));
      let g = 1e6;
      let ty = 0;
      if (2 * wf > 0.5 * lod) {
        const e = a.map((x) => s - x);
        const c = a.map((x) => Math.min(x, s) - x);
        const ex = beam([c[0], e[1], e[2]], [1, 0, 0], a[0] < s, sg, ji);
        const ey = beam([e[0], c[1], e[2]], [0, 1, 0], a[1] < s, sg, ji);
        const ez = beam([e[0], e[1], c[2]], [0, 0, 1], a[2] < s, sg, ji);
        g = Math.min(ex, ey, ez) - wf * smoothstep(0.5 * lod, lod, 2 * wf);
      }
      if (2 * wdi > 0.5 * lod) {
        const n = [0.57735027, 0.57735027, 0.57735027];
        const v = a.map((x) => x - s);
        const L2 = (1 - s) * Math.sqrt(3);
        const t = Math.min(L2, Math.max(0, dot(v, n)));
        const gd = beam(n.map((x, k) => x * t - v[k]), n, t > 0 && t < L2, sg, ji) - wdi * smoothstep(0.5 * lod, lod, 2 * wdi);
        ty = gd < g ? 1 : 0;
        g = smin(g, gd, 0.6 * Math.min(wf, wdi));
      }
      if (g < res.d) {
        res.d = g;
        res.mat = steps * 2 + ty;
      }
      if (m < s) {
        if (walls) bound = Math.min(bound, (s - m) / dr + mg);
        q = q.map((x) => x / s);
        ji = ji.map((c) => c.map((x) => x * s));
        dr /= s;
        if (i === 0) fd = 1;
      } else {
        let r, t, cx, cy, cz;
        if (a[0] >= a[1] && a[0] >= a[2]) [r, t, cx, cy, cz] = [a[0], [q[1], q[2]], ji[0].map((x) => x * sg[0]), ji[1], ji[2]];
        else if (a[1] >= a[2]) [r, t, cx, cy, cz] = [a[1], [q[2], q[0]], ji[1].map((x) => x * sg[1]), ji[2], ji[0]];
        else [r, t, cx, cy, cz] = [a[2], [q[0], q[1]], ji[2].map((x) => x * sg[2]), ji[0], ji[1]];
        const yz = [t[0] / r, t[1] / r];
        const g0 = (-r * r) / B;
        if (i === 0) bound = Math.min(bound, (r - s) / dr + mg);
        if (walls) {
          const wall = Math.min((r - Math.max(Math.abs(t[0]), Math.abs(t[1]))) * 0.70710678, r - s, 1 - r);
          bound = Math.min(bound, wall / dr + mg);
        }
        ji = [cx.map((x, k) => g0 * (x + yz[0] * cy[k] + yz[1] * cz[k])), cy.map((x) => r * x), cz.map((x) => r * x)];
        q = [A + B / r, yz[0], yz[1]];
        const dX = 1 / g0;
        dr *= Math.sqrt(dX * dX + (yz[0] ** 2 + yz[1] ** 2 + 2) / (r * r));
        steps++;
      }
    }
    res.d = Math.min(res.d, bound);
    return res;
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [x = 0.72, y = 0.42, z = 0.28, eps = 1e-4] = process.argv.slice(2).map(Number);
  const map = makeField();
  console.log(map([x, y, z], eps));
}
