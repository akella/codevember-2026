// Colonies of volvox as soft balls on a floor: each a closed skin of points that remembers being a
// sphere (shape matching), keeps its volume (so it bulges where it is not pressed), and carries its
// daughters inside, bedded in jelly. Nothing here knows about drawing; it runs in node as well.

export const V = {
  seed: 11,
  count: 11,
  sizeMin: 0.6,
  sizeMax: 1.32,
  gravity: 14,
  sink: 6.5, // fastest a colony falls through the water, units a second
  soft: 0.03, // how hard a colony of radius one pulls back to its shape each pass: smaller is softer
  softKid: 0.05,
  give: 0.55, // how far the shape it pulls back to follows the squash
  pressure: 2.2, // how hard lost volume pushes back out
  ripple: 0.35, // a point's motion evened with its neighbours': waves in the skin die down
  friction: 0.6,
  speed: 0.55, // how fast they roll about, units a second
  spin: 0.3, // and turn on the spot, radians a second
  wander: 0.62, // share of the rolling that is each one's own idea
  drive: 0.03,
  crowd: 2.4, // how near the light, in radii, before a colony stops pressing in
  kids: 8, // most daughters in one colony
  kidSpring: 60, // the jelly holding a daughter in its place
  kidDrag: 0.05, // and dragging on it
  kidCarry: 0.6, // how much of its mother's every lurch a daughter is spared
  kidGravity: 0.25,
  wall: 0.9, // inside of the skin, in radii
  dots: 2600, // cells on a colony of radius one
  hop: 6.5,
  dent: 0.32, // how deep a poke presses in before the skin gives, in radii
  fuse: 0.16, // and for how long, seconds
  tear: 0.34, // the skin is gone in this long
  burst: 3.4, // how fast the daughters are thrown out
  shock: 1.8, // and the neighbours pushed away
  grow: 1.75, // a freed daughter grows to this many times its size
  growAfter: 1.5, // starting this long after it is freed
  growFor: 24, // and taking this long
};

export const H = 1 / 120;
const PASSES = 2;

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A sphere of near enough equal triangles: every body is one of these, scaled.
export interface Ball {
  n: number;
  dirs: Float32Array; // unit vectors
  tris: Uint16Array;
  nbr: Int16Array; // up to six neighbours a point, -1 where there are five
  vol: number; // of the unit ball as triangles
}
export function ball(level: number): Ball {
  const t = (1 + Math.sqrt(5)) / 2;
  const pts: number[][] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map(([x, y, z]) => {
    const l = Math.sqrt(x * x + y * y + z * z);
    return [x / l, y / l, z / l];
  });
  let faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  for (let l = 0; l < level; l++) {
    const mids = new Map<number, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      let m = mids.get(key);
      if (m === undefined) {
        const x = pts[a][0] + pts[b][0],
          y = pts[a][1] + pts[b][1],
          z = pts[a][2] + pts[b][2];
        const len = Math.sqrt(x * x + y * y + z * z);
        m = pts.length;
        pts.push([x / len, y / len, z / len]);
        mids.set(key, m);
      }
      return m;
    };
    const next: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b),
        bc = mid(b, c),
        ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const n = pts.length;
  const dirs = new Float32Array(n * 3);
  pts.forEach((p, i) => dirs.set(p, i * 3));
  const tris = new Uint16Array(faces.flat());
  const nbr = new Int16Array(n * 6).fill(-1);
  const link = (a: number, b: number) => {
    for (let k = 0; k < 6; k++) {
      if (nbr[a * 6 + k] === b) return;
      if (nbr[a * 6 + k] < 0) {
        nbr[a * 6 + k] = b;
        return;
      }
    }
  };
  for (const [a, b, c] of faces) {
    link(a, b);
    link(b, a);
    link(b, c);
    link(c, b);
    link(c, a);
    link(a, c);
  }
  let vol = 0;
  for (const [a, b, c] of faces) {
    const [ax, ay, az] = pts[a],
      [bx, by, bz] = pts[b],
      [cx, cy, cz] = pts[c];
    vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return { n, dirs, tris, nbr, vol: vol / 6 };
}

export class Body {
  x: Float32Array;
  p: Float32Array; // where each point was a step ago
  n: number;
  c = new Float64Array(3);
  was = new Float64Array(3); // the middle a step ago
  q = Float64Array.of(0, 0, 0, 1); // which way it is turned
  qWas = Float64Array.of(0, 0, 0, 1);
  G = new Float64Array(9); // unit sphere to the shape it is pulling back to, about c
  Gi = new Float64Array(9);
  vol = 1; // of what it should be
  vol0: number;
  kids: Body[] = [];
  parent: Body | null = null;
  home = new Float64Array(3); // a daughter's place, in its mother's unit sphere
  aim = new Float64Array(3); // where that is now
  aimWas = new Float64Array(3);
  flowWas = new Float64Array(3); // how far its place moved in the step before
  planes: number[] = []; // what presses on it this step: nx, ny, nz, d with the inside n.x >= d
  heading = 0;
  mood = 0;
  turn = 1; // which way it spins
  grounded = 0;
  gone = false; // burst: no longer there to be bumped into
  prod: { t: number; dir: number[] } | null = null; // being poked: for how long, and where on it (from its middle)
  burstAt = -1; // the step its skin gave
  burstFrom = new Float64Array(3); // and where on the unit sphere it tore open from
  R0 = 0; // the size it was made
  grown = 1; // 0 a daughter, 1 a colony with its cells apart
  freedAt = -1;

  mesh: Ball;
  R: number;
  seed: number;

  constructor(mesh: Ball, R: number, seed: number, x: Float32Array, p: Float32Array) {
    this.mesh = mesh;
    this.R = R;
    this.seed = seed;
    this.x = x;
    this.p = p;
    this.n = mesh.n;
    this.vol0 = mesh.vol * R * R * R;
    this.R0 = R;
  }

  place(cx: number, cy: number, cz: number, q?: ArrayLike<number>) {
    const { x, p, mesh, R } = this;
    if (q) this.q.set(q);
    const m = turned(this.q);
    for (let i = 0; i < mesh.n * 3; i += 3) {
      const dx = mesh.dirs[i] * R,
        dy = mesh.dirs[i + 1] * R,
        dz = mesh.dirs[i + 2] * R;
      x[i] = p[i] = cx + m[0] * dx + m[1] * dy + m[2] * dz;
      x[i + 1] = p[i + 1] = cy + m[3] * dx + m[4] * dy + m[5] * dz;
      x[i + 2] = p[i + 2] = cz + m[6] * dx + m[7] * dy + m[8] * dz;
    }
    this.c[0] = this.was[0] = cx;
    this.c[1] = this.was[1] = cy;
    this.c[2] = this.was[2] = cz;
    this.qWas.set(this.q);
    for (let k = 0; k < 9; k++) this.G[k] = m[k] * R;
    invert(this.G, this.Gi);
  }

  // Set the whole body moving: units a second.
  kick(vx: number, vy: number, vz: number) {
    const { p } = this;
    for (let i = 0; i < this.n * 3; i += 3) {
      p[i] -= vx * H;
      p[i + 1] -= vy * H;
      p[i + 2] -= vz * H;
    }
    for (const k of this.kids) k.kick(vx, vy, vz);
  }
}

const M = new Float64Array(9);
export function turned(q: ArrayLike<number>) {
  const x = q[0],
    y = q[1],
    z = q[2],
    w = q[3];
  M[0] = 1 - 2 * (y * y + z * z);
  M[1] = 2 * (x * y - z * w);
  M[2] = 2 * (x * z + y * w);
  M[3] = 2 * (x * y + z * w);
  M[4] = 1 - 2 * (x * x + z * z);
  M[5] = 2 * (y * z - x * w);
  M[6] = 2 * (x * z - y * w);
  M[7] = 2 * (y * z + x * w);
  M[8] = 1 - 2 * (x * x + y * y);
  return M;
}
export function invert(m: Float64Array, out: Float64Array) {
  const a = m[0],
    b = m[1],
    c = m[2],
    d = m[3],
    e = m[4],
    f = m[5],
    g = m[6],
    h = m[7],
    i = m[8];
  const A = e * i - f * h,
    B = f * g - d * i,
    C = d * h - e * g;
  let det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) det = 1e-12;
  const s = 1 / det;
  out[0] = A * s;
  out[1] = (c * h - b * i) * s;
  out[2] = (b * f - c * e) * s;
  out[3] = B * s;
  out[4] = (a * i - c * g) * s;
  out[5] = (c * d - a * f) * s;
  out[6] = C * s;
  out[7] = (b * g - a * h) * s;
  out[8] = (a * e - b * d) * s;
}

// Pull a body towards the nearest turned, squashed sphere: find its middle, the best linear map from
// the unit sphere onto it, the turn in that map (Müller's quaternion iteration, warm from the last
// step), and move every point a little way to where a mix of the turned sphere and the squashed one
// would have it, swollen by whatever volume has been pressed out.
export function match(b: Body, alpha: number, beta: number) {
  const { x, n, q, R } = b;
  const d = b.mesh.dirs,
    tris = b.mesh.tris;
  const n3 = n * 3;
  let cx = 0,
    cy = 0,
    cz = 0;
  for (let i = 0; i < n3; i += 3) {
    cx += x[i];
    cy += x[i + 1];
    cz += x[i + 2];
  }
  cx /= n;
  cy /= n;
  cz /= n;
  let a00 = 0,
    a01 = 0,
    a02 = 0,
    a10 = 0,
    a11 = 0,
    a12 = 0,
    a20 = 0,
    a21 = 0,
    a22 = 0;
  for (let i = 0; i < n3; i += 3) {
    const px = x[i] - cx,
      py = x[i + 1] - cy,
      pz = x[i + 2] - cz;
    const dx = d[i],
      dy = d[i + 1],
      dz = d[i + 2];
    a00 += px * dx;
    a01 += px * dy;
    a02 += px * dz;
    a10 += py * dx;
    a11 += py * dy;
    a12 += py * dz;
    a20 += pz * dx;
    a21 += pz * dy;
    a22 += pz * dz;
  }
  const k = 3 / n; // the points' second moment on the unit sphere is a third each way
  a00 *= k;
  a01 *= k;
  a02 *= k;
  a10 *= k;
  a11 *= k;
  a12 *= k;
  a20 *= k;
  a21 *= k;
  a22 *= k;
  let r = turned(q);
  for (let it = 0; it < 3; it++) {
    let ox = r[3] * a20 - r[6] * a10 + (r[4] * a21 - r[7] * a11) + (r[5] * a22 - r[8] * a12),
      oy = r[6] * a00 - r[0] * a20 + (r[7] * a01 - r[1] * a21) + (r[8] * a02 - r[2] * a22),
      oz = r[0] * a10 - r[3] * a00 + (r[1] * a11 - r[4] * a01) + (r[2] * a12 - r[5] * a02);
    const den = Math.abs(r[0] * a00 + r[3] * a10 + r[6] * a20 + r[1] * a01 + r[4] * a11 + r[7] * a21 + r[2] * a02 + r[5] * a12 + r[8] * a22) + 1e-9;
    ox /= den;
    oy /= den;
    oz /= den;
    const w = Math.sqrt(ox * ox + oy * oy + oz * oz);
    if (w < 1e-9) break;
    const s = Math.sin(w / 2) / w,
      c = Math.cos(w / 2);
    const ax = ox * s,
      ay = oy * s,
      az = oz * s;
    const qx = q[0],
      qy = q[1],
      qz = q[2],
      qw = q[3];
    let nx = c * qx + ax * qw + ay * qz - az * qy,
      ny = c * qy - ax * qz + ay * qw + az * qx,
      nz = c * qz + ax * qy - ay * qx + az * qw,
      nw = c * qw - ax * qx - ay * qy - az * qz;
    const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
    nx *= l;
    ny *= l;
    nz *= l;
    nw *= l;
    q[0] = nx;
    q[1] = ny;
    q[2] = nz;
    q[3] = nw;
    r = turned(q);
  }
  let vol = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const i = tris[t] * 3,
      j = tris[t + 1] * 3,
      l = tris[t + 2] * 3;
    const ax = x[i] - cx,
      ay = x[i + 1] - cy,
      az = x[i + 2] - cz;
    const bx = x[j] - cx,
      by = x[j + 1] - cy,
      bz = x[j + 2] - cz;
    const ex = x[l] - cx,
      ey = x[l + 1] - cy,
      ez = x[l + 2] - cz;
    vol += ax * (by * ez - bz * ey) + ay * (bz * ex - bx * ez) + az * (bx * ey - by * ex);
  }
  vol /= 6 * b.vol0;
  b.vol = vol;
  const swell = clamp(Math.pow(1 / Math.max(vol, 0.08), V.pressure / 3), 0.92, 1.7);
  const G = b.G;
  const rb = (1 - beta) * R * swell,
    lb = beta * swell;
  G[0] = lb * a00 + rb * r[0];
  G[1] = lb * a01 + rb * r[1];
  G[2] = lb * a02 + rb * r[2];
  G[3] = lb * a10 + rb * r[3];
  G[4] = lb * a11 + rb * r[4];
  G[5] = lb * a12 + rb * r[5];
  G[6] = lb * a20 + rb * r[6];
  G[7] = lb * a21 + rb * r[7];
  G[8] = lb * a22 + rb * r[8];
  for (let i = 0; i < n3; i += 3) {
    const dx = d[i],
      dy = d[i + 1],
      dz = d[i + 2];
    x[i] += alpha * (cx + G[0] * dx + G[1] * dy + G[2] * dz - x[i]);
    x[i + 1] += alpha * (cy + G[3] * dx + G[4] * dy + G[5] * dz - x[i + 1]);
    x[i + 2] += alpha * (cz + G[6] * dx + G[7] * dy + G[8] * dz - x[i + 2]);
  }
  b.c[0] = cx;
  b.c[1] = cy;
  b.c[2] = cz;
}

// The floor: nothing goes below it, and what touches it is held back from sliding.
function floor(b: Body, at: number, friction: number) {
  const { x, p } = b;
  let hit = 0;
  for (let i = 0; i < b.n * 3; i += 3) {
    if (x[i + 1] < at) {
      x[i + 1] = at;
      p[i] += (x[i] - p[i]) * friction;
      p[i + 2] += (x[i + 2] - p[i + 2]) * friction;
      hit++;
    }
  }
  if (hit) b.grounded = 1;
}

// Two soft balls in each other's way meet on a flat wall between them, square to the line of their
// middles: how far each reaches along that line says how much they overlap, and each gives up a share.
export function press(a: Body, b: Body, record: boolean) {
  let nx = b.c[0] - a.c[0],
    ny = b.c[1] - a.c[1],
    nz = b.c[2] - a.c[2];
  const dist = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (dist > (a.R + b.R) * 1.6 || dist < 1e-6) return;
  nx /= dist;
  ny /= dist;
  nz /= dist;
  const ax = a.x,
    bx = b.x;
  let ea = -1e9,
    eb = 1e9;
  for (let i = 0; i < a.n * 3; i += 3) {
    const s = nx * ax[i] + ny * ax[i + 1] + nz * ax[i + 2];
    if (s > ea) ea = s;
  }
  for (let i = 0; i < b.n * 3; i += 3) {
    const s = nx * bx[i] + ny * bx[i + 1] + nz * bx[i + 2];
    if (s < eb) eb = s;
  }
  const over = ea - eb;
  if (over <= 0) return;
  // the bigger ball is the softer, and gives more
  const wall = ea - (over * a.R * a.R) / (a.R * a.R + b.R * b.R);
  for (let i = 0; i < a.n * 3; i += 3) {
    const s = nx * ax[i] + ny * ax[i + 1] + nz * ax[i + 2] - wall;
    if (s > 0) {
      ax[i] -= s * nx;
      ax[i + 1] -= s * ny;
      ax[i + 2] -= s * nz;
    }
  }
  for (let i = 0; i < b.n * 3; i += 3) {
    const s = wall - (nx * bx[i] + ny * bx[i + 1] + nz * bx[i + 2]);
    if (s > 0) {
      bx[i] += s * nx;
      bx[i + 1] += s * ny;
      bx[i + 2] += s * nz;
    }
  }
  if (record) {
    a.planes.push(-nx, -ny, -nz, -wall);
    b.planes.push(nx, ny, nz, wall);
  }
}

// A daughter stays inside its mother's skin, and inside whatever is pressing on its mother.
function hold(k: Body, skin: number) {
  const m = k.parent!;
  const { x } = k;
  const G = m.G,
    Gi = m.Gi;
  const cx = m.c[0],
    cy = m.c[1],
    cz = m.c[2];
  const wall = V.wall,
    wall2 = wall * wall;
  const pl = m.planes;
  for (let i = 0; i < k.n * 3; i += 3) {
    const rx = x[i] - cx,
      ry = x[i + 1] - cy,
      rz = x[i + 2] - cz;
    const ux = Gi[0] * rx + Gi[1] * ry + Gi[2] * rz,
      uy = Gi[3] * rx + Gi[4] * ry + Gi[5] * rz,
      uz = Gi[6] * rx + Gi[7] * ry + Gi[8] * rz;
    const l2 = ux * ux + uy * uy + uz * uz;
    if (l2 > wall2) {
      const s = wall / Math.sqrt(l2);
      const vx = ux * s,
        vy = uy * s,
        vz = uz * s;
      x[i] = cx + G[0] * vx + G[1] * vy + G[2] * vz;
      x[i + 1] = cy + G[3] * vx + G[4] * vy + G[5] * vz;
      x[i + 2] = cz + G[6] * vx + G[7] * vy + G[8] * vz;
    }
    if (x[i + 1] < skin) x[i + 1] = skin;
    for (let j = 0; j < pl.length; j += 4) {
      const s = pl[j + 3] + skin - (pl[j] * x[i] + pl[j + 1] * x[i + 1] + pl[j + 2] * x[i + 2]);
      if (s > 0) {
        x[i] += s * pl[j];
        x[i + 1] += s * pl[j + 1];
        x[i + 2] += s * pl[j + 2];
      }
    }
  }
}

const vx = new Float32Array(2600),
  vy = new Float32Array(2600),
  vz = new Float32Array(2600);

export class Sim {
  step = 0;
  big = ball(3);
  small = ball(2);
  tops: Body[] = [];
  kids: Body[] = [];
  topX: Float32Array;
  topP: Float32Array;
  kidX: Float32Array;
  kidP: Float32Array;
  bowl: number;
  light = [0, 0]; // where on the floor they are drawn to
  pointer: { x: number; z: number; until: number } | null = null;
  free: Body[] = []; // every body loose on the floor: colonies, and daughters let out
  ghosts: Body[] = []; // skins in the middle of tearing
  near: Body | null = null; // the one nearest the light
  watch: Body | null = null; // the last one poked: worth looking at
  watchAt = -1; // and when
  hover: { body: Body; until: number } | null = null; // the one under the pointer
  rand = rng(V.seed + 977);

  constructor() {
    const rand = rng(V.seed);
    const sizes: number[] = [];
    for (let i = 0; i < V.count; i++) sizes.push(V.sizeMin + (V.sizeMax - V.sizeMin) * Math.pow(rand(), 1.3));
    sizes[0] = V.sizeMax; // one big one always
    this.bowl = Math.sqrt(sizes.reduce((s, r) => s + r * r, 0) / 0.33);
    // daughters first, to know how many
    const plans: { r: number; home: number[] }[][] = sizes.map((R) => {
      const want = R < V.sizeMin + 0.12 * (V.sizeMax - V.sizeMin) ? 0 : Math.round(clamp(2 + rand() * (V.kids - 1) * smooth(0.5, 1.3, R) + rand() * 2, 0, V.kids));
      const out: { r: number; home: number[] }[] = [];
      const base = 0.17 + rand() * 0.1; // sisters are much of a size
      for (let tries = 0; tries < 400 && out.length < want; tries++) {
        const r = base * (0.82 + rand() * 0.36);
        const reach = V.wall - r - 0.04;
        const u = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
        const l = Math.hypot(u[0], u[1], u[2]);
        if (l > 1 || l < 1e-3) continue;
        const home = u.map((c) => c * reach);
        if (out.every((o) => Math.hypot(o.home[0] - home[0], o.home[1] - home[1], o.home[2] - home[2]) > (o.r + r) * 1.12)) out.push({ r, home });
      }
      return out;
    });
    const nk = plans.reduce((s, p) => s + p.length, 0);
    this.topX = new Float32Array(V.count * this.big.n * 3);
    this.topP = new Float32Array(V.count * this.big.n * 3);
    this.kidX = new Float32Array(Math.max(1, nk) * this.small.n * 3);
    this.kidP = new Float32Array(Math.max(1, nk) * this.small.n * 3);
    // somewhere to come down, clear of the others, and from how high: they arrive one after another
    const spots: number[][] = [];
    const order = sizes.map((_, i) => i).sort(() => rand() - 0.5);
    let ki = 0;
    sizes.forEach((R, i) => {
      let px = 0,
        pz = 0;
      for (let tries = 0, room = 1.08; tries < 4000; tries++, room *= 0.9995) {
        const a = rand() * Math.PI * 2,
          d = Math.sqrt(rand()) * (this.bowl - R * 0.5);
        px = Math.cos(a) * d;
        pz = Math.sin(a) * d * 0.8;
        if (spots.every(([x, z, r]) => Math.hypot(x - px, z - pz) > (r + R) * room)) break;
      }
      spots.push([px, pz, R]);
      const o = i * this.big.n * 3;
      const b = new Body(this.big, R, rand(), this.topX.subarray(o, o + this.big.n * 3), this.topP.subarray(o, o + this.big.n * 3));
      const q = [rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5];
      const ql = Math.hypot(q[0], q[1], q[2], q[3]);
      b.place(
        px,
        R + 1.5 + order.indexOf(i) * 2.1,
        pz,
        q.map((c) => c / ql),
      );
      b.heading = rand() * Math.PI * 2;
      b.mood = rand() * 100;
      b.turn = rand() < 0.5 ? -1 : 1;
      for (const plan of plans[i]) {
        const ko = ki++ * this.small.n * 3;
        const k = new Body(this.small, plan.r * R, rand(), this.kidX.subarray(ko, ko + this.small.n * 3), this.kidP.subarray(ko, ko + this.small.n * 3));
        k.parent = b;
        k.grown = 0;
        k.heading = rand() * Math.PI * 2;
        k.mood = rand() * 100;
        k.turn = rand() < 0.5 ? -1 : 1;
        k.home.set(plan.home);
        this.seat(k);
        k.aimWas.set(k.aim);
        k.place(k.aim[0], k.aim[1], k.aim[2]);
        b.kids.push(k);
        this.kids.push(k);
      }
      this.tops.push(b);
    });
    this.free = [...this.tops];
  }

  // where a daughter's place in the jelly is now
  seat(k: Body) {
    const m = k.parent!;
    const G = m.G,
      h = k.home;
    k.aim[0] = m.c[0] + G[0] * h[0] + G[1] * h[1] + G[2] * h[2];
    k.aim[1] = m.c[1] + G[3] * h[0] + G[4] * h[1] + G[5] * h[2];
    k.aim[2] = m.c[2] + G[6] * h[0] + G[7] * h[1] + G[8] * h[2];
  }

  // A poke along a line of sight: the first body the line meets. One with daughters is pressed in
  // there until its skin gives; one without only jumps.
  poke(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) {
    const hit = this.under(ox, oy, oz, dx, dy, dz);
    if (!hit) return null;
    const best = hit.body,
      first = hit.at;
    const dir = [ox + dx * first - best.c[0], oy + dy * first - best.c[1], oz + dz * first - best.c[2]];
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    this.prodAt(
      best,
      dir.map((c) => c / l),
    );
    return best;
  }
  // the first body a line of sight meets, and how far along
  under(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) {
    let best: Body | null = null,
      first = 1e9;
    for (const b of this.free) {
      const cx = b.c[0] - ox,
        cy = b.c[1] - oy,
        cz = b.c[2] - oz;
      const along = cx * dx + cy * dy + cz * dz;
      const off2 = cx * cx + cy * cy + cz * cz - along * along;
      const r = b.R * 1.03;
      if (along < 0 || off2 > r * r) continue;
      const at = along - Math.sqrt(r * r - off2);
      if (at < first) {
        first = at;
        best = b;
      }
    }
    return best ? { body: best, at: first } : null;
  }
  prodAt(b: Body, dir: number[]) {
    this.watch = b;
    this.watchAt = this.step;
    if (b.kids.length) b.prod ??= { t: 0, dir };
    else b.kick(-dir[0] * V.hop * 0.4, V.hop, -dir[2] * V.hop * 0.4);
  }

  // The skin gives where it was pressed. The body is no longer there; its daughters are thrown out,
  // each a body of its own from now on, and whatever is near is pushed away.
  burst(b: Body) {
    const dir = b.prod!.dir;
    const Gi = b.Gi;
    const fx = Gi[0] * dir[0] + Gi[1] * dir[1] + Gi[2] * dir[2],
      fy = Gi[3] * dir[0] + Gi[4] * dir[1] + Gi[5] * dir[2],
      fz = Gi[6] * dir[0] + Gi[7] * dir[1] + Gi[8] * dir[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    b.burstFrom[0] = fx / fl;
    b.burstFrom[1] = fy / fl;
    b.burstFrom[2] = fz / fl;
    b.prod = null;
    b.gone = true;
    b.burstAt = this.step;
    this.free = this.free.filter((o) => o !== b);
    this.ghosts.push(b);
    const rand = this.rand;
    for (const o of this.free) {
      const ex = o.c[0] - b.c[0],
        ey = o.c[1] - b.c[1],
        ez = o.c[2] - b.c[2];
      const d = Math.hypot(ex, ey, ez) || 1,
        reach = (b.R + o.R) * 1.8;
      if (d < reach) {
        const f = (V.shock * (1 - d / reach)) / d;
        o.kick(ex * f, Math.abs(ey) * f + 0.4 * V.shock * (1 - d / reach), ez * f);
      }
    }
    for (const k of b.kids) {
      let ex = k.c[0] - b.c[0],
        ey = k.c[1] - b.c[1],
        ez = k.c[2] - b.c[2];
      const d = Math.hypot(ex, ey, ez);
      if (d < 0.05 * b.R) {
        ex = rand() - 0.5;
        ey = rand() * 0.5;
        ez = rand() - 0.5;
      }
      const f = (V.burst * (0.55 + 0.9 * rand())) / (Math.hypot(ex, ey, ez) || 1);
      k.parent = null;
      k.freedAt = this.step;
      k.was.set(k.c);
      k.qWas.set(k.q);
      k.kick(ex * f, ey * f + V.burst * 0.4, ez * f);
      this.free.push(k);
    }
    b.kids = [];
  }

  tick() {
    const t = this.step * H;
    const g = V.gravity * H * H;
    const damp = (V.gravity * H) / V.sink; // drag that makes `sink` the terminal speed
    // the light they are drawn to: the pointer while it moves, a slow walk of its own otherwise
    const roam = this.bowl * 0.55;
    let lx = roam * Math.sin(t * 0.083 + 0.4) * 1.1,
      lz = roam * Math.sin(t * 0.127 + 1.9) * 0.7;
    if (this.pointer && this.pointer.until > this.step) {
      lx = this.pointer.x;
      lz = this.pointer.z;
    }
    this.light[0] += (lx - this.light[0]) * 0.02;
    this.light[1] += (lz - this.light[1]) * 0.02;

    // a poke presses in for a moment, and then the skin gives
    for (const b of [...this.free]) {
      const pr = b.prod;
      if (!pr) continue;
      const [dx, dy, dz] = pr.dir;
      const push = (V.dent * b.R * H) / V.fuse;
      const { x } = b;
      for (let i = 0; i < b.n * 3; i += 3) {
        const rx = x[i] - b.c[0],
          ry = x[i + 1] - b.c[1],
          rz = x[i + 2] - b.c[2];
        const w = smooth(0.72, 0.97, (rx * dx + ry * dy + rz * dz) / (Math.sqrt(rx * rx + ry * ry + rz * rz) || 1));
        x[i] -= dx * push * w;
        x[i + 1] -= dy * push * w;
        x[i + 2] -= dz * push * w;
      }
      pr.t += H;
      if (pr.t >= V.fuse) this.burst(b);
    }
    // a skin that has given keeps going the way it was, slowing, until it is all gone
    for (const b of [...this.ghosts]) {
      const { x, p } = b;
      if ((this.step - b.burstAt) * H > V.tear + 0.15) {
        for (let i = 0; i < b.n * 3; i += 3) {
          x[i] = p[i] = b.c[0];
          x[i + 1] = p[i + 1] = b.c[1];
          x[i + 2] = p[i + 2] = b.c[2];
        }
        this.ghosts = this.ghosts.filter((o) => o !== b);
        continue;
      }
      for (let i = 0; i < b.n * 3; i++) {
        const v = (x[i] - p[i]) * 0.95;
        p[i] = x[i];
        x[i] += v;
      }
    }
    // a daughter let out grows, and its cells draw apart
    for (const b of this.free) {
      if (b.freedAt < 0) continue;
      b.grown = smooth(V.growAfter, V.growAfter + V.growFor, (this.step - b.freedAt) * H);
      b.R = b.R0 * (1 + (V.grow - 1) * b.grown);
      b.vol0 = b.mesh.vol * b.R * b.R * b.R;
    }

    let nearest = 1e9;
    this.near = null;
    this.free.forEach((b) => {
      const { x, p, n } = b;
      const nb = b.mesh.nbr;
      // where it wants to go: towards the light until it is close, round on its own wandering, back
      // into the dish if it strays
      const tx = this.light[0] - b.c[0],
        tz = this.light[1] - b.c[2];
      const far = Math.sqrt(tx * tx + tz * tz) + 1e-6;
      if (far < nearest && b.freedAt < 0) {
        nearest = far;
        this.near = b;
      }
      b.heading += (Math.sin(t * 0.31 + b.mood) + Math.sin(t * 0.13 + b.mood * 1.7)) * 0.4 * H;
      const keen = (1 - V.wander) * smooth(V.crowd * b.R, V.crowd * b.R + 2.5, far) * (0.6 + 0.4 * Math.sin(t * 0.21 + b.mood * 2.3));
      let ux = (tx / far) * keen + Math.cos(b.heading) * V.wander,
        uz = (tz / far) * keen + Math.sin(b.heading) * V.wander;
      const out = Math.hypot(b.c[0], b.c[2] / 0.8);
      if (out > this.bowl) {
        ux -= (b.c[0] / out) * (out - this.bowl);
        uz -= (b.c[2] / out) * (out - this.bowl);
      }
      ux *= V.speed;
      uz *= V.speed;
      // how it moved and turned over the last step
      const mx = b.c[0] - b.was[0],
        my = b.c[1] - b.was[1],
        mz = b.c[2] - b.was[2];
      const q = b.q,
        w = b.qWas;
      // q times the conjugate of what it was: a small turn, twice its vector part
      let rx = 2 * (w[3] * q[0] - q[3] * w[0] - (q[1] * w[2] - q[2] * w[1])),
        ry = 2 * (w[3] * q[1] - q[3] * w[1] - (q[2] * w[0] - q[0] * w[2])),
        rz = 2 * (w[3] * q[2] - q[3] * w[2] - (q[0] * w[1] - q[1] * w[0]));
      if (q[0] * w[0] + q[1] * w[1] + q[2] * w[2] + q[3] * w[3] < 0) {
        rx = -rx;
        ry = -ry;
        rz = -rz;
      }
      b.was.set(b.c);
      b.qWas.set(q);
      // rolling without slipping at the speed it really has, and the spin on top
      const on = b.grounded;
      const wantX = (mz / b.R) * 1,
        wantY = V.spin * b.turn * H,
        wantZ = -mx / b.R;
      const D = V.drive * on;
      const dx = D * (ux * H - mx),
        dz = D * (uz * H - mz);
      const ox = D * (wantX - rx) * 4,
        oy = D * (wantY - ry) * 4,
        oz = D * (wantZ - rz) * 4;
      void my;
      b.grounded = 0;
      b.planes.length = 0;
      const n3 = n * 3;
      for (let i = 0, j = 0; i < n3; i += 3, j++) {
        vx[j] = x[i] - p[i];
        vy[j] = x[i + 1] - p[i + 1];
        vz[j] = x[i + 2] - p[i + 2];
      }
      const keep = 1 - damp,
        rip = V.ripple;
      const cx = b.c[0],
        cy = b.c[1],
        cz = b.c[2];
      for (let i = 0, j = 0; i < n3; i += 3, j++) {
        let sx = 0,
          sy = 0,
          sz = 0,
          m = 0;
        for (let k = j * 6; k < j * 6 + 6; k++) {
          const o = nb[k];
          if (o < 0) break;
          sx += vx[o];
          sy += vy[o];
          sz += vz[o];
          m++;
        }
        const wx = vx[j] + (sx / m - vx[j]) * rip,
          wy = vy[j] + (sy / m - vy[j]) * rip,
          wz = vz[j] + (sz / m - vz[j]) * rip;
        const ax = x[i] - cx,
          ay = x[i + 1] - cy,
          az = x[i + 2] - cz;
        p[i] = x[i];
        p[i + 1] = x[i + 1];
        p[i + 2] = x[i + 2];
        x[i] += wx * keep + dx + (oy * az - oz * ay);
        x[i + 1] += wy * keep - g + (oz * ax - ox * az);
        x[i + 2] += wz * keep + dz + (ox * ay - oy * ax);
      }
    });

    // daughters: carried by the jelly, sprung to their places in it, a little heavier than it
    const spring = V.kidSpring * H * H,
      kg = g * V.kidGravity;
    for (const k of this.kids) {
      if (!k.parent) continue;
      const { x, p, n } = k;
      const fx = k.aim[0] - k.aimWas[0],
        fy = k.aim[1] - k.aimWas[1],
        fz = k.aim[2] - k.aimWas[2];
      const sx = (k.aim[0] - k.c[0]) * spring,
        sy = (k.aim[1] - k.c[1]) * spring - kg,
        sz = (k.aim[2] - k.c[2]) * spring;
      const keep = 1 - V.kidDrag;
      // what its place has just done that it did not do the step before: the lurch
      const jx = (fx - k.flowWas[0]) * V.kidCarry,
        jy = (fy - k.flowWas[1]) * V.kidCarry,
        jz = (fz - k.flowWas[2]) * V.kidCarry;
      k.flowWas[0] = fx;
      k.flowWas[1] = fy;
      k.flowWas[2] = fz;
      for (let i = 0; i < n * 3; i += 3) {
        const wx = x[i] - p[i],
          wy = x[i + 1] - p[i + 1],
          wz = x[i + 2] - p[i + 2];
        p[i] = x[i];
        p[i + 1] = x[i + 1];
        p[i + 2] = x[i + 2];
        x[i] += fx + (wx - fx + jx) * keep + sx;
        x[i + 1] += fy + (wy - fy + jy) * keep + sy;
        x[i + 2] += fz + (wz - fz + jz) * keep + sz;
      }
    }

    const free = this.free;
    for (let pass = 0; pass < PASSES; pass++) {
      for (const b of free) {
        match(b, Math.min(0.12, V.soft / (b.R * b.R)), V.give); // a big one sags more under its own weight
        floor(b, 0, V.friction);
        b.planes.length = 0;
      }
      for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) press(free[i], free[j], true);
      for (const b of free) {
        invert(b.G, b.Gi);
        const ks = b.kids;
        for (const k of ks) match(k, V.softKid, V.give);
        for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) press(ks[i], ks[j], false);
        for (const k of ks) hold(k, 0.03 * b.R);
      }
    }
    for (const k of this.kids) {
      if (!k.parent) continue;
      k.aimWas.set(k.aim);
      this.seat(k);
    }
    this.step++;
  }
}
