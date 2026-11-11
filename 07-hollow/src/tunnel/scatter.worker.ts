// The cells' points, placed off the main thread (it takes a second or so, and the picture mustn't stop).
// Points over the wall, each at least its spacing from the rest, measured on the folded wall (Bridson's
// way, the wall wrapping both ways); then each one's nearest, and for each square of a grid a point by it.
import { MOST, NEAR, sizesFor } from "./sizes";

const TAU = Math.PI * 2;

function scatter(
  map: Uint8Array | Uint8ClampedArray,
  radius: number,
  widest: number,
  grade: number,
  relax: number,
  mixed: number,
  PERIOD: number,
) {
  const { CREST, GRID } = sizesFor(PERIOD);
  const pointData = new Float32Array(MOST * 4),
    nearData = new Float32Array(MOST * NEAR),
    seedData = new Float32Array(GRID[0] * GRID[1]);
  const W = TAU * radius,
    H = PERIOD;
  const least = Math.max(widest / (1 + grade), 0.012);
  const read = (x: number, y: number) =>
    (Math.min(CREST[1] - 1, Math.floor((y / H) * CREST[1])) * CREST[0] +
      Math.min(CREST[0] - 1, Math.floor((x / W) * CREST[0]))) *
    4;
  const spacingAt = (x: number, y: number) =>
    widest + (least - widest) * (map[read(x, y)] / 255);
  // the stretch there: [a, b, c], and the least any step is stretched
  const stretchOf = (x: number, y: number) => {
    const at = read(x, y);
    const p = (map[at + 1] / 255) * 4,
      q = (map[at + 3] / 255) * 4,
      lean = (map[at + 2] / 255) * 2 - 1;
    const a = p * p,
      c = q * q,
      b = lean * p * q;
    const half = (a + c) / 2;
    return [
      a,
      b,
      c,
      Math.sqrt(
        Math.max(
          half - Math.sqrt(Math.max(half * half - (a * c - b * b), 0)),
          0.05,
        ),
      ),
    ];
  };
  const wrap = (v: number, n: number) => ((v % n) + n) % n;
  const near = (d: number, n: number) => d - Math.round(d / n) * n;
  // buckets of points, to find the ones near a place
  const size = Math.max(least, 0.02);
  const bw = Math.max(1, Math.floor(W / size)),
    bh = Math.max(1, Math.floor(H / size));
  const head = new Int32Array(bw * bh).fill(-1);
  const next: number[] = [],
    xs: number[] = [],
    ys: number[] = [],
    rs: number[] = [];
  const eachNear = (
    x: number,
    y: number,
    reach: number,
    body: (k: number) => void,
  ) => {
    const sx = Math.min(Math.ceil(reach / (W / bw)), bw >> 1),
      sy = Math.min(Math.ceil(reach / (H / bh)), bh >> 1);
    const cx = Math.floor((x / W) * bw),
      cy = Math.floor((y / H) * bh);
    for (let dy = -sy; dy <= sy; dy++)
      for (let dx = -sx; dx <= sx; dx++)
        for (
          let k = head[wrap(cy + dy, bh) * bw + wrap(cx + dx, bw)];
          k >= 0;
          k = next[k]
        )
          body(k);
  };
  const put = (x: number, y: number, r: number) => {
    const cell =
      Math.min(bh - 1, Math.floor((y / H) * bh)) * bw +
      Math.min(bw - 1, Math.floor((x / W) * bw));
    next.push(head[cell]);
    head[cell] = xs.length;
    xs.push(x);
    ys.push(y);
    rs.push(r);
  };
  let seed = 12345;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  put(W / 2, H / 2, spacingAt(W / 2, H / 2));
  const active = [0];
  while (active.length && xs.length < MOST) {
    const pick = Math.floor(random() * active.length);
    const k = active[pick];
    const [a0, b0, c0] = stretchOf(xs[k], ys[k]);
    let found = false;
    for (let tries = 0; tries < 16 && !found; tries++) {
      const turn = random() * TAU;
      const ux = Math.cos(turn),
        uy = Math.sin(turn);
      // (a step that's, on the wall, between one and 1.6 spacings long)
      const d =
        (rs[k] * (1 + random() * 0.6)) /
        Math.sqrt(a0 * ux * ux + 2 * b0 * ux * uy + c0 * uy * uy);
      const x = wrap(xs[k] + ux * d, W),
        y = wrap(ys[k] + uy * d, H);
      const r = spacingAt(x, y);
      const [a, b, c, tight] = stretchOf(x, y);
      let fits = true;
      eachNear(x, y, r / tight, (j) => {
        if (!fits) return;
        const dx = near(xs[j] - x, W),
          dy = near(ys[j] - y, H);
        const need = (r + rs[j]) / 2;
        if (a * dx * dx + 2 * b * dx * dy + c * dy * dy < need * need)
          fits = false;
      });
      if (fits) {
        put(x, y, r);
        active.push(xs.length - 1);
        found = true;
      }
    }
    if (!found) ((active[pick] = active[active.length - 1]), active.pop());
  }
  // Some grow: big cells among the small, as a foam has (bubbles that took in the ones round them). One
  // that grows takes the room of the neighbours it covers, which go.
  // (a point's size is the circle it keeps clear: as scattered, 1.25 of its spacing; grown, as it is)
  let fs = new Float32Array(xs.length).fill(1);
  const PAD = 1.25;
  const sizeOf = (i: number) => (fs[i] > 1 ? rs[i] : rs[i] * PAD) / 2;
  if (mixed > 0) {
    const all = xs.length;
    const gone = new Uint8Array(all);
    const far2 = (i: number, j: number, g: number[]) => {
      const dx = near(xs[j] - xs[i], W),
        dy = near(ys[j] - ys[i], H);
      return g[0] * dx * dx + 2 * g[1] * dx * dy + g[2] * dy * dy;
    };
    for (let i = 0; i < all; i++) {
      const lucky = random() < mixed * 0.1,
        much = random();
      if (gone[i] || !lucky) continue;
      const r = rs[i] * (1.8 + 1.8 * much * much);
      const g = stretchOf(xs[i], ys[i]);
      // (not into another big one)
      let free = true;
      eachNear(xs[i], ys[i], (r + widest * 3.6) / 2 / g[3], (j) => {
        if (j === i || gone[j] || fs[j] === 1 || !free) return;
        const need = (r + rs[j]) / 2;
        if (far2(i, j, g) < need * need) free = false;
      });
      if (!free) continue;
      fs[i] = 2;
      rs[i] = r;
      eachNear(xs[i], ys[i], r / g[3], (j) => {
        if (j === i || gone[j] || fs[j] > 1) return;
        const need = r / 2 + rs[j] * 0.3;
        if (far2(i, j, g) < need * need) gone[j] = 1;
      });
    }
    let kept = 0;
    for (let i = 0; i < all; i++)
      if (!gone[i]) {
        xs[kept] = xs[i];
        ys[kept] = ys[i];
        rs[kept] = rs[i];
        fs[kept++] = fs[i];
      }
    xs.length = ys.length = rs.length = next.length = kept;
    fs = fs.slice(0, kept);
  }
  const count = xs.length;
  const fill = () => {
    head.fill(-1);
    for (let i = 0; i < count; i++) {
      const cell =
        Math.min(bh - 1, Math.floor((ys[i] / H) * bh)) * bw +
        Math.min(bw - 1, Math.floor((xs[i] / W) * bw));
      next[i] = head[cell];
      head[cell] = i;
    }
  };
  // the big ones, and how big each is of its place's spacing
  const bigs: number[] = [];
  const grown = new Float32Array(count).fill(1);
  let biggest = 0;
  for (let i = 0; i < count; i++)
    if (fs[i] > 1) {
      bigs.push(i);
      grown[i] = rs[i] / spacingAt(xs[i], ys[i]);
      biggest = Math.max(biggest, rs[i]);
    }
  // Evened out: each pushed off the ones too near it, a few times over. As scattered, some cells are
  // cramped and sharp-cornered; spread evenly, they pack like circles, each its own size.
  // (small ones look only as far as small ones reach; the few big ones look further, and push both ways)
  for (let pass = 0; pass < relax; pass++) {
    fill();
    const mx = new Float32Array(count),
      my = new Float32Array(count);
    const push = (i: number, j: number, g: number[], both: boolean) => {
      const dx = near(xs[j] - xs[i], W),
        dy = near(ys[j] - ys[i], H);
      const d = Math.sqrt(g[0] * dx * dx + 2 * g[1] * dx * dy + g[2] * dy * dy);
      const apart = sizeOf(i) + sizeOf(j);
      if (d >= apart || d < 1e-9) return;
      // (the bigger of two moves the less)
      const by = ((apart - d) / d) * 0.6,
        share = rs[j] / (rs[i] + rs[j]);
      mx[i] -= dx * by * share;
      my[i] -= dy * by * share;
      if (both)
        ((mx[j] += dx * by * (1 - share)), (my[j] += dy * by * (1 - share)));
    };
    for (let i = 0; i < count; i++) {
      if (fs[i] > 1) continue;
      const g = stretchOf(xs[i], ys[i]);
      eachNear(xs[i], ys[i], (((rs[i] + widest) / 2) * PAD) / g[3], (j) => {
        if (j !== i && fs[j] === 1) push(i, j, g, false);
      });
    }
    for (const i of bigs) {
      const g = stretchOf(xs[i], ys[i]);
      eachNear(xs[i], ys[i], ((rs[i] + biggest) / 2 + widest) / g[3], (j) => {
        if (j !== i && (fs[j] === 1 || j > i)) push(i, j, g, true);
      });
    }
    for (let i = 0; i < count; i++) {
      xs[i] = wrap(xs[i] + mx[i], W);
      ys[i] = wrap(ys[i] + my[i], H);
      rs[i] = spacingAt(xs[i], ys[i]) * grown[i];
    }
  }
  fill();
  // Each one's neighbours on the wall: the NEAR whose own circles come nearest. Cells are cut between two
  // points nearer the smaller (a power diagram: each point's reach is its size), so a big cell has many
  // small neighbours.
  nearData.fill(-1);
  seedData.fill(-1);
  const farthest = new Float32Array(GRID[0] * GRID[1]).fill(Infinity);
  type Found = [number, number, number];
  const lists: Found[][] = Array.from({ length: count }, () => []);
  const meet = (i: number, j: number, g: number[]) => {
    const dx = near(xs[j] - xs[i], W),
      dy = near(ys[j] - ys[i], H);
    return Math.sqrt(g[0] * dx * dx + 2 * g[1] * dx * dy + g[2] * dy * dy);
  };
  for (let i = 0; i < count; i++) {
    if (fs[i] > 1) continue;
    const g = stretchOf(xs[i], ys[i]);
    eachNear(xs[i], ys[i], (rs[i] * 1.6 + widest * 0.8) / g[3], (j) => {
      if (j === i || fs[j] > 1) return;
      const d = meet(i, j, g);
      lists[i].push([d - sizeOf(j), j, d]);
    });
  }
  for (const i of bigs) {
    const g = stretchOf(xs[i], ys[i]);
    eachNear(
      xs[i],
      ys[i],
      ((rs[i] + biggest) / 2 + widest * 1.5) / g[3],
      (j) => {
        if (j === i) return;
        const d = meet(i, j, g);
        lists[i].push([d - sizeOf(j), j, d]);
        if (fs[j] === 1) lists[j].push([d - sizeOf(i), i, d]);
      },
    );
  }
  for (let i = 0; i < count; i++) {
    const [a, b, c, tight] = stretchOf(xs[i], ys[i]);
    const found = lists[i];
    found.sort((p, q) => p[0] - q[0]);
    // (and a circle about it the size of its cell: as far as its borders with its six nearest, on average)
    const own = sizeOf(i) * sizeOf(i);
    let around = 0;
    const six = Math.min(6, found.length);
    for (let k = 0; k < six; k++) {
      const [, j, d] = found[k];
      around += (d * d + own - sizeOf(j) * sizeOf(j)) / (2 * d);
    }
    pointData.set(
      [xs[i], ys[i], sizeOf(i) * 2, six ? around / six : sizeOf(i)],
      i * 4,
    );
    for (let k = 0; k < Math.min(NEAR, found.length); k++)
      nearData[i * NEAR + k] = found[k][1];
    // and it's the nearest so far (by its reach) to the squares round it
    const reach = (sizeOf(i) * 2.6) / tight;
    const sx = Math.ceil(reach / (W / GRID[0])),
      sy = Math.ceil(reach / (H / GRID[1]));
    const cx = Math.floor((xs[i] / W) * GRID[0]),
      cy = Math.floor((ys[i] / H) * GRID[1]);
    for (let dy = -sy; dy <= sy; dy++)
      for (let dx = -sx; dx <= sx; dx++) {
        const ox = ((dx + 0.5) * W) / GRID[0] - (xs[i] - (cx * W) / GRID[0]),
          oy = ((dy + 0.5) * H) / GRID[1] - (ys[i] - (cy * H) / GRID[1]);
        const d = a * ox * ox + 2 * b * ox * oy + c * oy * oy - own;
        const sq = wrap(cy + dy, GRID[1]) * GRID[0] + wrap(cx + dx, GRID[0]);
        if (d < farthest[sq]) ((farthest[sq] = d), (seedData[sq] = i));
      }
  }
  // (a square none reached takes its neighbour's)
  for (let pass = 0; pass < 8; pass++) {
    let left = 0;
    for (let sq = 0; sq < seedData.length; sq++)
      if (seedData[sq] < 0) {
        const beside = seedData[sq === 0 ? seedData.length - 1 : sq - 1];
        const above = seedData[(sq + GRID[0]) % seedData.length];
        if (beside >= 0) seedData[sq] = beside;
        else if (above >= 0) seedData[sq] = above;
        else left++;
      }
    if (!left) break;
  }
  return { count, pointData, nearData, seedData };
}

self.onmessage = (e: MessageEvent) => {
  const { id, map, radius, size, grade, relax, mixed, period } = e.data;
  const t0 = performance.now();
  const made = scatter(map, radius, size, grade, relax, mixed, period);
  (self as any).postMessage({ id, ms: performance.now() - t0, ...made }, [
    made.pointData.buffer,
    made.nearData.buffer,
    made.seedData.buffer,
  ]);
};
