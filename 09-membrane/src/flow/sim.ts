// The run: colonies rolling down a V-shaped channel, the front ones bursting and their daughters
// rolling on, for ever, the camera closing in fourfold each time round.
//
// What makes that a loop is that nothing here has a size of its own. A V looks the same at every scale,
// and every body gets its physics at the scale of its generation: weight, speeds, the throw of a burst
// all a quarter of its mother's. So a daughter's life can be her mother's again, a quarter the size,
// one period later. Soft bodies bumping do not repeat by themselves, so each is also drawn, very
// gently, towards what the one in its place a generation before was doing at the same age; as they
// come to agree that pull falls away to nothing, and what is left is plain physics that repeats.
//
// The numbers would run out after a few generations (a quarter, a sixteenth, ...), so each time a
// front colony bursts the whole world is made four times bigger about it: exact in floating point.
import { ball, type Ball, Body, H, invert, match, press, rng, smooth } from "../volvox/soft.ts";

export const F = {
  period: 12, // seconds from one front colony bursting to the next
  steep: 18, // degrees each wall of the channel rises: shallow enough that they run several abreast and heap up in the fold
  tilt: 15, // degrees it runs downhill
  gravity: 14,
  sink: 6.5, // fastest anything falls, radii of its generation a second
  soft: 0.03,
  give: 0.55,
  ripple: 0.35,
  friction: 0.6,
  swim: 2.2, // each one's own push down the channel, on top of rolling: the speed it makes for, radii a second
  bite: 0.09, // how quickly it gets up to that speed: the snap of a lunge
  hurry: 1.2, // the ones behind make for this much more, so they close up on the ones ahead
  hurryOver: 9, // radii behind the front one at which that is in full
  surges: 5, // lunges in a period: each starts at the back and runs forward through them
  surge: 3.2, // how much faster a lunge is
  surgeRun: 0.45, // how far the lunge has run on, in turns, for each radius further forward
  weave: 0.5, // and each pushes a little to one side or the other as it lunges
  every: 0.12, // of a period, from one bursting to the one behind it
  follow: 0.03, // how hard each is drawn to what its forerunner did, a step: 0 leaves them free
  followTurn: 0.03,
  early: 4, // and that many times harder still while it is newly out, before it has found its place in the line
  wild: 2, // generations left to themselves at the start: what is followed is learnt from the ones after
  ramp: 3, // generations over which the drawing comes on
  fresh: 0.35, // what is followed leans at least this much on the latest generation: it forgets its rough start
  learn: 9, // generations that still change what is followed: after that it is fixed
  matureFrom: 0.06, // of a period after it is let out, its cells start to draw apart
  matureBy: 0.58,
  extraLife: 1.3, // periods a daughter of the ones behind is kept
  dent: 0.32,
  fuse: 0.16,
  tear: 0.34,
  burst: 1.5, // how hard the daughters are thrown: gently, they mostly fall
  shock: 0.9,
  kidSpring: 60,
  kidDamp: 0.55,
};
export const K = 5; // daughters in every colony
export const RATIO = 0.25; // a generation is this much smaller than the last
const SIZES = [1, 0.9, 1.08, 0.86, 0.96]; // the five of a litter, in their generation's radii
const PASSES = 2;
const BIG = 12, // bodies kept of the pack the camera follows (the skin of the big ball)
  SMALL = 46; // and of the daughters of those behind
const POKE = [0.45, 0.62, 0.64]; // where on it a colony gives, from its middle

export interface Track {
  data: Float32Array; // middle and turn, each step of a life: the mean of every body that has had this key
  len: number;
  lives: number; // how many that is
}
interface Pack {
  members: Cell[];
  due: number[]; // the steps they burst at, front one first
  next: number;
  burst: number;
}

export class Cell extends Body {
  alive = false;
  pool = 0;
  key = 0; // which place in the family it has: the same key a generation on does the same things
  sigma = 1; // the scale of its generation
  born = 0;
  pack: Pack | null = null;
  guide: Track | null = null;
  weight = 0; // how much its own life counts in what its key's bodies follow
  pull = 0; // how much of the drawing it gets
  inner = new Float64Array(K * 9); // its daughters, carried: middle, speed, where their place was a step ago
  there = 1; // fades out a body that is being dropped
  freeAt = -1; // the step its place can be given to another
  swim = 1;
  id = 0; // changes each time the place is given to a new body
}

const vx = new Float32Array(700),
  vy = new Float32Array(700),
  vz = new Float32Array(700);

export class Flow {
  step = 0;
  TS = Math.round(F.period / H);
  big = ball(3);
  small = ball(2);
  pools: { mesh: Ball; x: Float32Array; p: Float32Array; cells: Cell[] }[];
  free: Cell[] = [];
  ghosts: Cell[] = [];
  packs: Pack[] = [];
  tracks: (Track | null)[] = new Array(K + K * K).fill(null);
  homes: Float64Array[] = []; // for each key, where its five daughters sit in it
  swims: number[] = [];
  turns: number[][] = []; // which way up each kind of body is when it is let out
  seeds: number[] = [];
  seam = 0; // the step of the last front burst
  seams = 0;
  ids = 0;
  // the camera's subject: where, and how big the pack is
  view = { x: 0, y: 0.8, z: 0, scale: 1 };
  back = [0, 0, 0]; // from the middle of the new pack to the middle of the old, when its front one burst
  // the last time the world was made bigger: for whoever keeps things of their own in it
  rebase = { count: 0, x: 0, by: 1 };
  wall = [0, 1, 0]; // the right wall's normal (the left is its mirror in z)
  down = [0, -1, 0];
  missed = 0;
  order: number[] | null = null; // which of a pack bursts first, second, ...: by key, once it has been learnt
  packsMade = 0;
  frontX = 0; // how far down the channel the front one of the newest pack is
  drawn = 0; // how far bodies have been moved by the drawing, in their own radii, and how far they went in all
  went = 0;

  constructor() {
    const rand = rng(31);
    this.pools = [
      [this.big, BIG],
      [this.small, SMALL],
    ].map(([mesh, count], pi) => {
      const m = mesh as Ball,
        c = count as number;
      const x = new Float32Array(c * m.n * 3),
        p = new Float32Array(c * m.n * 3);
      const cells: Cell[] = [];
      for (let i = 0; i < c; i++) {
        const o = i * m.n * 3;
        const cell = new Cell(m, 1, 0, x.subarray(o, o + m.n * 3), p.subarray(o, o + m.n * 3));
        cell.pool = pi;
        cells.push(cell);
      }
      return { mesh: m, x, p, cells };
    });
    // Five daughters at the corners of a double pyramid, turned a different way in each kind of body
    const base = [
      [0.5, 0, 0],
      [-0.25, 0, 0.433],
      [-0.25, 0, -0.433],
      [0, 0.5, 0],
      [0, -0.5, 0],
    ];
    for (let key = 0; key < K + K * K; key++) {
      const q = [rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5];
      const l = Math.hypot(q[0], q[1], q[2], q[3]);
      const [x, y, z, w] = q.map((c) => c / l);
      const m = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
      const h = new Float64Array(K * 3);
      base.forEach((b, j) => {
        const jit = 0.92 + 0.16 * rand();
        for (let r = 0; r < 3; r++) h[j * 3 + r] = (m[r * 3] * b[0] + m[r * 3 + 1] * b[1] + m[r * 3 + 2] * b[2]) * jit;
      });
      this.homes.push(h);
      this.turns.push([x, y, z, w]);
      this.swims.push(0.75 + 0.6 * rand());
      this.seeds.push(rand());
    }
    this.slope();
    // the first pack: five in a row, let fall into the channel
    const members: Cell[] = [];
    for (let c = 0; c < K; c++) {
      const R = SIZES[c];
      const cell = this.spawn(0, c, 1, R, [(c - 2) * 2.25 + (rand() - 0.5) * 0.3, R / Math.cos((F.steep * Math.PI) / 180) + 0.6 + rand() * 1.2, (rand() - 0.5) * 0.4], [0, 0, 0, 1], [0, 0, 0])!;
      members.push(cell);
    }
    this.packs.push(this.packOf(members, this.TS));
    this.look();
  }

  slope() {
    const b = (F.steep * Math.PI) / 180,
      t = (F.tilt * Math.PI) / 180;
    this.wall = [0, Math.cos(b), -Math.sin(b)];
    this.down = [Math.sin(t), -Math.cos(t), 0];
  }

  packOf(members: Cell[], first: number): Pack {
    const gap = Math.round(F.every * this.TS);
    this.packsMade++;
    const pack = { members, due: members.map((_, k) => first + k * gap), next: 0, burst: 0 };
    for (const m of members) m.pack = pack;
    return pack;
  }

  // A new body in a free place of a pool.
  spawn(pool: number, key: number, sigma: number, R: number, at: number[], q: ArrayLike<number>, v: number[]) {
    const cell = this.pools[pool].cells.find((c) => !c.alive && c.freeAt <= this.step);
    if (!cell) {
      this.missed++;
      return null;
    }
    cell.alive = true;
    cell.id = ++this.ids;
    cell.key = key;
    cell.sigma = sigma;
    cell.R = cell.R0 = R;
    cell.vol0 = cell.mesh.vol * R * R * R;
    cell.seed = this.seeds[key];
    cell.swim = this.swims[key];
    cell.born = this.step;
    cell.grown = 0;
    cell.gone = false;
    cell.prod = null;
    cell.burstAt = -1;
    cell.there = 1;
    cell.pack = null;
    cell.grounded = 0;
    cell.place(at[0], at[1], at[2], q);
    cell.kick(v[0], v[1], v[2]);
    // It follows the mean of what every body with its key has done before it, and its own life is
    // added to that mean: a full share at first, less each generation, then nothing. Following only
    // the one before lets the whole thing drift a little each time round, for ever.
    let track = this.tracks[key];
    if (!track) track = this.tracks[key] = { data: new Float32Array(Math.ceil(this.TS * 1.75) * 7), len: 0, lives: 0 };
    track.lives++;
    cell.guide = track;
    const past = track.lives - F.wild; // generations of this key that have been drawn to the mean
    cell.weight = track.lives > F.learn ? 0 : past <= 1 ? 1 : Math.max(F.fresh, 1 / past);
    cell.pull = Math.min(1, Math.max(0, past - 1) / F.ramp);
    const h = this.homes[key],
      G = cell.G,
      inn = cell.inner;
    for (let j = 0; j < K; j++) {
      for (let r = 0; r < 3; r++) {
        inn[j * 9 + r] = inn[j * 9 + 6 + r] = cell.c[r] + G[r * 3] * h[j * 3] + G[r * 3 + 1] * h[j * 3 + 1] + G[r * 3 + 2] * h[j * 3 + 2];
        inn[j * 9 + 3 + r] = v[r];
      }
    }
    this.free.push(cell);
    return cell;
  }

  // The skin gives: the body is gone, and its daughters are bodies of their own from here. The front
  // one of a pack lets out the next pack, and the world is made bigger about it; the ones behind let
  // out daughters that only keep the pack company for a while.
  burst(b: Cell) {
    const dir = b.prod!.dir;
    const Gi = b.Gi;
    const f = [0, 1, 2].map((r) => Gi[r * 3] * dir[0] + Gi[r * 3 + 1] * dir[1] + Gi[r * 3 + 2] * dir[2]);
    const fl = Math.hypot(f[0], f[1], f[2]) || 1;
    b.burstFrom.set(f.map((c) => c / fl));
    b.prod = null;
    b.gone = true;
    b.burstAt = this.step;
    b.freeAt = this.step + Math.round((F.tear + 6) / H); // its cells are still in the air for a while
    this.free = this.free.filter((o) => o !== b);
    this.ghosts.push(b);
    const pack = b.pack!;
    const front = pack.burst++ === 0;
    for (const o of this.free) {
      const e = [o.c[0] - b.c[0], o.c[1] - b.c[1], o.c[2] - b.c[2]];
      const d = Math.hypot(e[0], e[1], e[2]) || 1,
        reach = (b.R + o.R) * 1.8;
      if (d < reach) {
        const push = (F.shock * b.sigma * (1 - d / reach)) / d;
        o.kick(e[0] * push, Math.abs(e[1]) * push + 0.4 * F.shock * b.sigma * (1 - d / reach), e[2] * push);
      }
    }
    const old = front ? this.middle(pack.members) : null;
    const sigma = b.sigma * RATIO;
    const litter: Cell[] = [];
    for (let j = 0; j < K; j++) {
      const at = [b.inner[j * 9], b.inner[j * 9 + 1], b.inner[j * 9 + 2]];
      const e = [at[0] - b.c[0], at[1] - b.c[1], at[2] - b.c[2]];
      // thrown out from the middle, each of the five its own share as hard, every generation the same
      const push = (F.burst * b.sigma * (0.55 + 0.9 * ((j * 0.37 + b.key * 0.21) % 1))) / (Math.hypot(e[0], e[1], e[2]) || 1);
      const v = [b.inner[j * 9 + 3] + e[0] * push, b.inner[j * 9 + 4] + e[1] * push + F.burst * b.sigma * 0.4, b.inner[j * 9 + 5] + e[2] * push];
      // (which way up it starts is its own, not its mother's: nothing of how she rolled is handed on)
      const key = front ? j : K + b.key * K + j;
      const kid = this.spawn(front ? 0 : 1, key, sigma, SIZES[j] * sigma, at, this.turns[key], v);
      if (kid) litter.push(kid);
    }
    if (old && litter.length) {
      this.packs.push(this.packOf(litter, this.step + this.TS));
      this.seam = this.step;
      this.seams++;
      const mid = this.middle(litter),
        by = 1 / RATIO;
      this.back = [(old[0] - mid[0]) * by, (old[1] - mid[1]) * by, (old[2] - mid[2]) * by];
      this.grow(b.c[0], by);
    }
    if (pack.burst === pack.members.length) this.packs = this.packs.filter((p) => p !== pack);
  }

  middle(cells: Cell[]) {
    const m = [0, 0, 0];
    for (const c of cells) for (let r = 0; r < 3; r++) m[r] += c.c[r] / cells.length;
    return m;
  }

  // Everything by times about a point on the channel's line.
  grow(ox: number, by: number) {
    for (const pool of this.pools) {
      for (const a of [pool.x, pool.p]) {
        for (let i = 0; i < a.length; i += 3) {
          a[i] = (a[i] - ox) * by;
          a[i + 1] *= by;
          a[i + 2] *= by;
        }
      }
      for (const c of pool.cells) {
        for (const v of [c.c, c.was]) {
          v[0] = (v[0] - ox) * by;
          v[1] *= by;
          v[2] *= by;
        }
        c.R *= by;
        c.R0 *= by;
        c.sigma *= by;
        c.vol0 *= by * by * by;
        for (let k = 0; k < 9; k++) {
          c.G[k] *= by;
          c.Gi[k] /= by;
        }
        const inn = c.inner;
        for (let j = 0; j < K; j++) {
          inn[j * 9] = (inn[j * 9] - ox) * by;
          inn[j * 9 + 6] = (inn[j * 9 + 6] - ox) * by;
          for (const r of [1, 2, 3, 4, 5, 7, 8]) inn[j * 9 + r] *= by;
        }
      }
    }
    this.frontX = (this.frontX - ox) * by;
    this.rebase = { count: this.rebase.count + 1, x: ox, by };
  }

  // Where the camera should be looking and how big what it is looking at is. From the moment a front
  // one bursts it is the middle of the pack that was, sliding over to the middle of the new pack as
  // it closes in on it.
  look() {
    const pack = this.packs[this.packs.length - 1];
    if (!pack) return;
    const mid = this.middle(pack.members);
    if (!this.seams) {
      this.view = { x: mid[0], y: mid[1], z: mid[2], scale: 1 };
      return;
    }
    const u = Math.min(1, (this.step - this.seam) / this.TS);
    const scale = Math.pow(1 / RATIO, 1 - u);
    const k = (scale - 1) / (1 / RATIO - 1);
    this.view = { x: mid[0] + this.back[0] * k, y: mid[1] + this.back[1] * k, z: mid[2] + this.back[2] * k, scale };
  }

  tick() {
    const TS = this.TS;
    const [wy, wz] = [this.wall[1], this.wall[2]];
    const damp = (F.gravity * H) / F.sink;

    // the bursts that are due: the front one of the pack is pressed in, and gives
    const fuse = Math.round(F.fuse / H);
    for (const pack of [...this.packs]) {
      if (pack.next < pack.members.length && this.step === pack.due[pack.next] - fuse) {
        // The front one goes first. Abreast, which one is in front can turn on a hair, and the whole
        // family tree with it, so once the early generations are over the order they burst in is kept:
        // being drawn to what their forerunners did, the same ones will be in front anyway.
        if (pack.next === 0 && !this.order && this.packsMade > F.wild) this.order = [...pack.members].sort((a, b) => b.c[0] - a.c[0]).map((m) => m.key);
        let front: Cell | null = null;
        if (this.order) front = pack.members.find((m) => m.key === this.order![pack.next] && m.alive && !m.gone && !m.prod) ?? null;
        else for (const m of pack.members) if (m.alive && !m.gone && !m.prod && (!front || m.c[0] > front.c[0])) front = m;
        if (front) front.prod = { t: 0, dir: POKE };
        pack.next++;
      }
    }
    for (const b of [...this.free]) {
      const pr = b.prod;
      if (!pr) continue;
      const [dx, dy, dz] = pr.dir;
      const push = (F.dent * b.R * H) / F.fuse;
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
      if (pr.t >= F.fuse - 1e-9) this.burst(b);
    }
    // a skin that has given keeps going the way it was, slowing, until it is all gone
    for (const b of [...this.ghosts]) {
      const { x, p } = b;
      if ((this.step - b.burstAt) * H > F.tear + 0.15) {
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
    // places whose cells have all come down are free again; daughters of the ones behind are dropped
    // once they are old, fading
    for (const pool of this.pools) for (const c of pool.cells) if (c.alive && c.gone && c.freeAt <= this.step) c.alive = false;
    for (const b of [...this.free]) {
      const age = (this.step - b.born) / TS;
      b.grown = smooth(F.matureFrom, F.matureBy, age);
      if (b.key >= K) {
        b.there = 1 - smooth(F.extraLife - 0.12, F.extraLife, age);
        if (age >= F.extraLife) {
          b.alive = false;
          b.freeAt = this.step;
          this.free = this.free.filter((o) => o !== b);
        }
      }
    }

    // how far through the period, and where the front of the newest pack is: the lunges go by these
    const u = this.seams ? (this.step - this.seam) / TS : this.step / TS;
    const surges = Math.round(F.surges);
    const newest = this.packs[this.packs.length - 1];
    let frontX = -1e9;
    if (newest) for (const m of newest.members) if (m.alive && !m.gone && m.c[0] > frontX) frontX = m.c[0];
    if (frontX > -1e8) this.frontX = frontX;
    else frontX = this.frontX;
    for (const b of this.free) {
      const { x, p, n } = b;
      const nb = b.mesh.nbr;
      const s = b.sigma;
      const gx = this.down[0] * F.gravity * H * H * s,
        gy = this.down[1] * F.gravity * H * H * s;
      const mx = b.c[0] - b.was[0],
        mz = b.c[2] - b.was[2];
      b.was.set(b.c);
      b.qWas.set(b.q);
      // Its own push down the channel, while it has something to push against. The ones behind make
      // for more, so they close up and shove; and several times a period a lunge starts at the back and
      // runs forward through them all, so those behind hit the ones ahead just before those lunge too.
      const behind = Math.max(0, (frontX - b.c[0]) / s);
      const turn = surges * u + behind * F.surgeRun;
      const lunge = Math.pow(Math.max(0, Math.sin(turn * Math.PI * 2)), 3);
      // (the big ones left of the pack before, about to burst, only roll: four times the size, a lunge of
      // theirs would plough through everything young ahead of them)
      const old = b.pack && b.pack !== newest ? 0 : 1;
      const aim = old * F.swim * b.swim * (1 + F.hurry * smooth(0, F.hurryOver, behind) + F.surge * lunge);
      const dx = F.bite * b.grounded * Math.max(0, aim * s * H - mx);
      // to one side as it lunges, a different side each lunge: they do not all end up in one file
      const side = Math.sin(Math.floor(turn) * 2.4 + b.key * 1.7) * F.weave * F.swim * lunge;
      const dz = F.bite * b.grounded * (side * s * H - mz) * (lunge > 0 ? 1 : 0);
      b.grounded = 0;
      const n3 = n * 3;
      for (let i = 0, j = 0; i < n3; i += 3, j++) {
        vx[j] = x[i] - p[i];
        vy[j] = x[i + 1] - p[i + 1];
        vz[j] = x[i + 2] - p[i + 2];
      }
      const keep = 1 - damp,
        rip = F.ripple;
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
        p[i] = x[i];
        p[i + 1] = x[i + 1];
        p[i + 2] = x[i + 2];
        x[i] += (vx[j] + (sx / m - vx[j]) * rip) * keep + gx + dx;
        x[i + 1] += (vy[j] + (sy / m - vy[j]) * rip) * keep + gy;
        x[i + 2] += (vz[j] + (sz / m - vz[j]) * rip) * keep + dz;
      }
    }

    const free = this.free;
    for (let pass = 0; pass < PASSES; pass++) {
      for (const b of free) {
        const rel = b.R / b.sigma;
        match(b, Math.min(0.12, F.soft / (rel * rel)), F.give);
        // the two walls: nothing goes through them, and what touches them is held back from sliding
        const { x, p } = b;
        let hit = 0;
        for (let i = 0; i < b.n * 3; i += 3) {
          for (let side = -1; side <= 1; side += 2) {
            const nz = wz * side;
            const d = wy * x[i + 1] + nz * x[i + 2];
            if (d < 0) {
              x[i + 1] -= d * wy;
              x[i + 2] -= d * nz;
              const ux = x[i] - p[i],
                uy = x[i + 1] - p[i + 1],
                uz = x[i + 2] - p[i + 2];
              const un = uy * wy + uz * nz;
              p[i] += ux * F.friction;
              p[i + 1] += (uy - un * wy) * F.friction;
              p[i + 2] += (uz - un * nz) * F.friction;
              hit++;
            }
          }
        }
        if (hit) b.grounded = 1;
        b.planes.length = 0;
      }
      for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) press(free[i], free[j], false);
    }

    for (const b of free) {
      invert(b.G, b.Gi);
      const age = this.step - b.born;
      // Drawn towards what its forerunner did at this age: moved and turned a little, whole, so
      // nothing is added to how fast it is going.
      const g = b.guide;
      if (g && age < g.len && b.pull > 0 && (F.follow > 0 || F.followTurn > 0)) {
        const o = age * 7,
          d = g.data;
        const pull = b.pull * F.follow * (1 + F.early * (1 - smooth(0.05, 0.25, age / TS)));
        const sx = (d[o] - b.c[0]) * pull,
          sy = (d[o + 1] - b.c[1]) * pull,
          sz = (d[o + 2] - b.c[2]) * pull;
        // the turn from where it is to where it should be: the guide times the inverse of its own
        const q = b.q;
        let ex = q[3] * d[o + 3] - d[o + 6] * q[0] - (d[o + 4] * q[2] - d[o + 5] * q[1]),
          ey = q[3] * d[o + 4] - d[o + 6] * q[1] - (d[o + 5] * q[0] - d[o + 3] * q[2]),
          ez = q[3] * d[o + 5] - d[o + 6] * q[2] - (d[o + 3] * q[1] - d[o + 4] * q[0]);
        let ew = d[o + 6] * q[3] + d[o + 3] * q[0] + d[o + 4] * q[1] + d[o + 5] * q[2];
        if (ew < 0) {
          ex = -ex;
          ey = -ey;
          ez = -ez;
          ew = -ew;
        }
        const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
        const turn = el > 1e-9 ? (2 * Math.atan2(el, ew) * F.followTurn * b.pull) / el : 0;
        ex *= turn;
        ey *= turn;
        ez *= turn;
        const { x, p } = b;
        const cx = b.c[0],
          cy = b.c[1],
          cz = b.c[2];
        for (let i = 0; i < b.n * 3; i += 3) {
          const rx = x[i] - cx,
            ry = x[i + 1] - cy,
            rz = x[i + 2] - cz;
          const mx = sx + ey * rz - ez * ry,
            my = sy + ez * rx - ex * rz,
            mz = sz + ex * ry - ey * rx;
          x[i] += mx;
          x[i + 1] += my;
          x[i + 2] += mz;
          p[i] += mx;
          p[i + 1] += my;
          p[i + 2] += mz;
        }
        b.c[0] += sx;
        b.c[1] += sy;
        b.c[2] += sz;
        this.drawn += Math.hypot(sx, sy, sz) / b.R;
      }
      this.went += Math.hypot(b.c[0] - b.was[0], b.c[1] - b.was[1], b.c[2] - b.was[2]) / b.R;
      // and its own doings go into the mean (where it was before being drawn anywhere this step would be
      // truer, but by so little that it is not worth the bookkeeping)
      if (g && age * 7 + 6 < g.data.length && (b.weight > 0 || age >= g.len)) {
        const o = age * 7,
          d = g.data,
          w = age >= g.len ? 1 : b.weight;
        d[o] += (b.c[0] - d[o]) * w;
        d[o + 1] += (b.c[1] - d[o + 1]) * w;
        d[o + 2] += (b.c[2] - d[o + 2]) * w;
        // turns are averaged as four numbers, the nearer of a turn's two signs, and made a turn again
        const q = b.q;
        const sign = w < 1 && d[o + 3] * q[0] + d[o + 4] * q[1] + d[o + 5] * q[2] + d[o + 6] * q[3] < 0 ? -1 : 1;
        let qx = d[o + 3] + (q[0] * sign - d[o + 3]) * w,
          qy = d[o + 4] + (q[1] * sign - d[o + 4]) * w,
          qz = d[o + 5] + (q[2] * sign - d[o + 5]) * w,
          qw = d[o + 6] + (q[3] * sign - d[o + 6]) * w;
        const ql = 1 / (Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1);
        d[o + 3] = qx * ql;
        d[o + 4] = qy * ql;
        d[o + 5] = qz * ql;
        d[o + 6] = qw * ql;
        qx = qy = qz = qw = 0;
        if (age >= g.len) g.len = age + 1;
      }
      // its daughters: each on a spring to its place in the jelly, lagging when their mother lurches
      const h = this.homes[b.key],
        G = b.G,
        inn = b.inner;
      const ks = F.kidSpring,
        kd = 2 * F.kidDamp * Math.sqrt(ks);
      for (let j = 0; j < K; j++) {
        for (let r = 0; r < 3; r++) {
          const aim = b.c[r] + G[r * 3] * h[j * 3] + G[r * 3 + 1] * h[j * 3 + 1] + G[r * 3 + 2] * h[j * 3 + 2];
          const o = j * 9 + r;
          const going = (aim - inn[o + 6]) / H;
          inn[o + 3] += (ks * (aim - inn[o]) - kd * (inn[o + 3] - going)) * H;
          inn[o] += inn[o + 3] * H;
          inn[o + 6] = aim;
        }
      }
    }
    this.step++;
    this.look();
  }

  // The state as the loop would have it the same every time round: every body by its key, in the
  // measure of the moment. Two of these a period apart should be equal.
  snapshot() {
    const out = new Map<number, number[]>();
    for (const b of this.free) out.set(b.key + (this.step - b.born >= this.TS ? 100 : 0), [b.c[0], b.c[1], b.c[2], b.q[0], b.q[1], b.q[2], b.q[3], b.R]);
    return out;
  }
}
