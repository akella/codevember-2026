// The bolt: grown from one waypoint to the next (Yun, Son, Choi, Kim, Yoon 2017), each cell chosen by the pull of
// where it is going over the push of what has been grown.
import { add, len, lerp, mul, sub, unit, type V3 } from "./blades.ts";

export const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// a piece of it: from, to, how bright, how far down the bolt (0 the top, 1 the floor), and whether it is the channel
export type Piece = { a: V3; b: V3; lum: number; s: number; main: boolean };

type Grown = { points: V3[]; from: number[]; hit: number };

function grow(
  a: V3,
  b: V3 | null,
  o: { h: number; eta: number; rho: number; most: number; rand: () => number; old?: V3[]; keep?: number },
): Grown {
  const { h, eta, rho, most, rand, old = [], keep = 0 } = o;
  const cell = (p: V3): V3 => [Math.round(p[0] / h), Math.round(p[1] / h), Math.round(p[2] / h)];
  const A = cell(a);
  const B = b && cell(b);
  const O = old.map((p) => mul(p, 1 / h));
  const apart = (p: V3, q: V3) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  const force = (r2: number) => Math.pow(r2, -rho / 2);
  const cells: V3[] = [];
  const from: number[] = [];
  const seen = new Set<string>([A.join()]);
  const edge: { p: V3; push: number; pull: number; from: number; f: number; w: number }[] = [];
  const take = (p: V3, parent: number) => {
    const id = cells.length;
    cells.push(p);
    from.push(parent);
    for (const c of edge) c.push += force(apart(c.p, p));
    for (let i = -1; i < 2; i++)
      for (let j = -1; j < 2; j++)
        for (let k = -1; k < 2; k++) {
          const q: V3 = [p[0] + i, p[1] + j, p[2] + k];
          const key = q.join();
          if (seen.has(key)) continue;
          seen.add(key);
          let push = 0;
          for (const c of cells) push += force(apart(q, c));
          let pull = B ? force(Math.max(0.25, apart(q, B))) : 1;
          if (keep) {
            let near = 1e9;
            for (const c of O) near = Math.min(near, apart(q, c));
            pull *= 1 + keep * Math.exp(-near / 4);
          }
          edge.push({ p: q, push, pull, from: id, f: 0, w: 0 });
        }
  };
  take(A, -1);
  let hit = -1;
  while (cells.length < most) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of edge) {
      c.f = c.pull / c.push;
      lo = Math.min(lo, c.f);
      hi = Math.max(hi, c.f);
    }
    let sum = 0;
    for (const c of edge) sum += c.w = Math.pow((c.f - lo) / (hi - lo || 1), eta);
    let t = rand() * sum;
    let i = 0;
    for (; i < edge.length - 1; i++) if ((t -= edge[i].w) <= 0) break;
    const c = edge[i];
    edge[i] = edge[edge.length - 1];
    edge.pop();
    take(c.p, c.from);
    if (B && apart(c.p, B) < 3.3) {
      hit = cells.length - 1;
      break;
    }
  }
  // (anywhere in its cell, or the grid shows)
  const points = cells.map((p) => p.map((v) => (v + (rand() - 0.5) * 0.95) * h) as V3);
  points[0] = a;
  return { points, from, hit };
}

// a line bent at random about its middle, and each half again
function crumple(a: V3, b: V3, levels: number, rough: number, rand: () => number): V3[] {
  if (!levels) return [a, b];
  const l = len(sub(b, a));
  const m = add(lerp(a, b, 0.5), [(rand() - 0.5) * l * rough, (rand() - 0.5) * l * rough, (rand() - 0.5) * l * rough]);
  return [...crumple(a, m, levels - 1, rough, rand), ...crumple(m, b, levels - 1, rough, rand).slice(1)];
}

export type Bolt = { pieces: Piece[]; path: V3[][] };

export function strike(way: V3[], seed: number, o: { cell: number; eta: number; rho: number; forks: number; sparks: number; old?: V3[][]; keep?: number; floor?: number }): Bolt {
  const rand = random(seed * 7919 + 13);
  const pieces: Piece[] = [];
  const path: V3[][] = [];
  const hops = way.length - 1;
  const total = way.slice(1).reduce((t, p, i) => t + len(sub(p, way[i])), 0);
  let before = 0;
  const branch = (g: Grown, skip: Uint8Array, s0: (i: number) => number, strong: number, rate: number) => {
    const size = new Float64Array(g.points.length).fill(1);
    for (let i = g.points.length - 1; i > 0; i--) size[g.from[i]] += size[i];
    for (let i = 1; i < g.points.length; i++) {
      if (skip[i]) continue;
      const lum = strong * Math.pow(size[i] / 12, 0.8);
      if (lum < 0.026) continue;
      let [k, up] = [i, 0];
      while (k > 0 && !skip[k]) {
        k = g.from[k];
        up++;
      }
      pieces.push({ a: g.points[g.from[i]], b: g.points[i], lum: Math.min(lum, 0.5), s: s0(k) + up * rate, main: false });
    }
  };
  for (let i = 0; i < hops; i++) {
    const [a, b] = [way[i], way[i + 1]];
    const l = len(sub(b, a));
    let g: Grown;
    let tries = 0;
    do g = grow(a, b, { h: o.cell, eta: o.eta, rho: o.rho, most: 700, rand, old: o.old?.[i].filter((_, k) => k % 2 == 0), keep: o.keep });
    while (g.hit < 0 && ++tries < 4);
    const onMain = new Uint8Array(g.points.length);
    const order = new Float64Array(g.points.length);
    let main: V3[] = [];
    for (let k = g.hit; k >= 0; k = g.from[k]) {
      onMain[k] = 1;
      main.push(g.points[k]);
    }
    main.reverse();
    {
      let n = 0;
      for (let k = g.hit; k >= 0; k = g.from[k]) order[k] = 1 - n++ / main.length;
    }
    main.push(b);
    // a channel is less crooked than the cells it went through, and crooked again below them
    const soft = main.map((p, k) => (k && k < main.length - 1 ? lerp(p, lerp(main[k - 1], main[k + 1], 0.5), 0.45) : p));
    main = soft.flatMap((p, k) => (k ? crumple(soft[k - 1], p, 1, 0.4, rand).slice(1) : [p]));
    for (let k = 1; k < main.length; k++)
      pieces.push({ a: main[k - 1], b: main[k], lum: 1, s: (before + (l * (k - 0.5)) / (main.length - 1)) / total, main: true });
    branch(g, onMain, (k) => (before + l * (order[k] || 0)) / total, 0.3, 0.004);
    path.push(main);
    // forks: out of the channel, to nowhere much
    for (let f = 0; f < o.forks; f++) {
      const k = Math.floor((0.1 + 0.8 * rand()) * main.length);
      const p = main[k];
      const away = unit([rand() - 0.5, rand() - 0.6, rand() - 0.5]);
      const along = unit(sub(b, a));
      const to = add(p, mul(unit(add(away, mul(along, 0.5))), 0.5 + rand() * 1.1));
      const q = grow(p, to, { h: o.cell * 0.8, eta: 3.5, rho: 2, most: 60 + Math.floor(rand() * 60), rand });
      branch(q, new Uint8Array(q.points.length).fill(1, 0, 1), () => (before + (l * k) / main.length) / total, 0.16, 0.006);
    }
    // sparks, where it touches glass
    {
      const g2 = grow(b, null, { h: o.cell * 0.62, eta: 2.6, rho: 2, most: o.sparks, rand });
      branch(g2, new Uint8Array(g2.points.length).fill(1, 0, 1), () => (before + l) / total, 0.2, 0.003);
    }
    before += l;
  }
  // nothing under the floor
  const floor = (o.floor ?? 0) - 0.01;
  return { pieces: pieces.filter((p) => p.a[1] > floor && p.b[1] > floor), path };
}

// The pieces in a tree of boxes that a ray walks without a stack: a node is met, or skipped with all under it.
// A leaf holds up to four pieces. Node: min.xyz, where to go if missed; max.xyz, leaf? first piece * 8 + count : -1
export const LEAF = 4;
export function tree(pieces: Piece[], wide: (p: Piece) => number) {
  const nodes: number[] = [];
  const order: Piece[] = [];
  const build = (list: Piece[]) => {
    const at = nodes.length / 8;
    nodes.push(0, 0, 0, 0, 0, 0, 0, -1);
    const lo: V3 = [1e9, 1e9, 1e9];
    const hi: V3 = [-1e9, -1e9, -1e9];
    for (const p of list)
      for (const q of [p.a, p.b])
        for (let c = 0; c < 3; c++) {
          lo[c] = Math.min(lo[c], q[c] - wide(p));
          hi[c] = Math.max(hi[c], q[c] + wide(p));
        }
    if (list.length <= LEAF) {
      nodes[at * 8 + 7] = order.length * 8 + list.length;
      order.push(...list);
    } else {
      // cut where the boxes of the two sides, each by how many are in it, come out smallest
      let best = Infinity;
      let sorted = list;
      let cut = list.length >> 1;
      for (let c = 0; c < 3; c++) {
        const by = [...list].sort((p, q) => p.a[c] + p.b[c] - q.a[c] - q.b[c]);
        const areas = (l: Piece[]) => {
          const mn: V3 = [1e9, 1e9, 1e9];
          const mx: V3 = [-1e9, -1e9, -1e9];
          return l.map((p) => {
            for (const q of [p.a, p.b])
              for (let k = 0; k < 3; k++) {
                mn[k] = Math.min(mn[k], q[k] - wide(p));
                mx[k] = Math.max(mx[k], q[k] + wide(p));
              }
            const e = sub(mx, mn);
            return e[0] * e[1] + e[1] * e[2] + e[2] * e[0];
          });
        };
        const left = areas(by);
        const right = areas([...by].reverse()).reverse();
        for (let k = 1; k < by.length; k++) {
          const cost = left[k - 1] * Math.ceil(k / LEAF) + right[k] * Math.ceil((by.length - k) / LEAF);
          if (cost < best) [best, sorted, cut] = [cost, by, k];
        }
      }
      build(sorted.slice(0, cut));
      build(sorted.slice(cut));
    }
    nodes.splice(at * 8, 7, ...lo, nodes.length / 8, ...hi);
    return at;
  };
  build(pieces);
  const out = new Float32Array(order.length * 8);
  order.forEach((p, i) => out.set([...p.a, p.lum * (p.main ? 1 : -1), ...p.b, p.s], i * 8));
  return { nodes: new Float32Array(nodes), pieces: out, count: order.length };
}

// the channel in a few long pieces, for its light on things and the glow round it
export function coarse(bolt: Bolt, most: number) {
  const all = bolt.pieces.filter((p) => p.main);
  return Array.from({ length: most }, (_, i) => {
    const part = all.slice(Math.floor((i * all.length) / most), Math.floor(((i + 1) * all.length) / most));
    return { a: part[0].a, b: part[part.length - 1].b, s: part[part.length >> 1].s };
  });
}
