// The cells: pure numbers, no drawing, so it runs the same in the page and in node.
//
// Every cell carries one smaller cell. Two cells fuse, their two inner cells find themselves in one
// body, swim round each other and fuse in turn, K times smaller, one period later. Generation g fuses
// at step g * TS, and everything about it is a function of its age, so the picture one period on is the
// same picture K times deeper.

export const K = 4; // each generation is this many times smaller than the one holding it
export const N = 256; // membrane points per cell
export const CIL = 2; // hairs per membrane point
export const BORN = -4; // age (in periods, 0 = fusion) at which a cell appears inside its parent
export const DUSTY = -2; // age at which it gets its dust: before that the specks are too small to see
export const DIES = 2; // age at which a fused cell has grown past the camera and is dropped
export const HAIRY = -2.75; // age from which hairs are worth moving
export const BN = 40; // membrane points of a lodger

export const P = {
  period: 12, // seconds per generation
  hz: 120, // physics steps per second
  iters: 2,
  aspect: 1.65, // long axis over short
  species: 2, // kinds of cell taking turns down the generations: 1 is the same cell all the way down
  aspect2: 1.2, // the other kind is rounder
  hair2: 0.36, // and has fewer, longer, stiffer hairs
  hairShare2: 0.3,
  turn: 110, // degrees the pair swings round each other per generation

  edge: 0.9, // membrane: keeps its length
  bend: 0.25, // stays smooth
  area: 0.6, // keeps its contents
  shape: 0.02, // returns to an ellipse
  shapeSwim: 0.02, // the same while it is swimming to the other: lower, and it squashes more against what is in its way
  shapeMerged: 0.012,
  steer: 1,
  flow: 0.2, // a membrane is a fluid: how fast its points even themselves out along it
  slack: 0, // how much a freshly fused membrane resists being shorter than it is: more than a little and it crimps
  lazy: 1, // how much of its smoothness a fused membrane keeps while it rounds off: less is slower
  tensionTime: 2.8, // seconds for a fused membrane to take up its slack
  shapeTime: 6, // seconds for the fused cell to start wanting to be one ellipse
  seamTime: 1.5, // seconds the two halves of a fused membrane still keep off each other

  dragMembrane: 0.12, // seconds for a membrane to settle into the fluid round it
  dragContents: 0.4, // seconds for the contents to come to rest in their cell
  follow: 7, // how hard a cell goes after the place it is meant to be
  followSwim: 7, // the same for one swimming to the other: lower, and what is in its way holds it up for longer
  swirl: 0.1, // contents drifting round inside, radians a second
  wander: 0.03, // and each a little about its own place, in cell radii
  brown: 0.35, // dust jitters
  homeTime: 1.4, // seconds for something pushed aside to drift back to its place
  dustHome: 5,
  berth: 1.25, // how wide a berth their places give an inner cell, in its own lengths
  clearing: 1.5, // and how wide a space is left for two inner cells to meet in, in their radii
  clearFrom: 0.45, // from this far through their swim

  gapFar: 0.14, // room the hairs keep between two cells, in cell radii
  gapNear: 0.012,
  press: 0.05, // how far the two lean into each other before the membranes give
  contactAt: 0.8, // share of the period by which they touch

  hair: 0.17, // length, in cell radii
  beat: 1.5, // strokes a second
  hairWaves: 5, // phase along the body: the wave running tailwards
  hairTilt: 0.35,
  hairSwing: 0.5,
  hairLag: 0.06,
  hairStray: 0.3, // how far each leans its own way
  hairSweep: 0.5, // and how far they are swept back in a lunge

  lodgers: 5, // cell-like things living in each cell, up to five
  seatSize: 0.2, // how big that lodger is, in cell radii
  seatShift: 0.02, // how far off the middle the lodger nearest the other cell sits: head on, it is anyone's guess which way it goes
  strokes: 4, // the swim to the other cell is made in this many straight runs
  stretch: 0.13, // how much longer a cell is at full lunge
  squeeze: 0.15, // how deep the waist that runs down it as it lunges
  weave: 0.2, // how far the runs zigzag to either side, as a share of the way
  slide: 1.2, // length of the last run, alongside the other cell, in radii
  backUp: 0.14, // how far it backs up before a run, as a share of the run
  lodgerHome: 1.1, // seconds for a lodger pushed aside to come back
  lodgerShape: 0.012, // how hard a lodger holds its shape
  lodgerGap: 0.04, // room between a swimming cell and a lodger, in the cell's radii
  yield: 0.6, // how much of a shove between a cell and a lodger the cell takes
  offAlong: 0.45, // where two inner cells meet, from the middle of the cell that holds them: along it, in its radii
  offAcross: 0.2, // and across it, towards one of the two, which then has less far to go
  ride: 0.3, // how far off the middle an inner cell rides in its own cell before that
  fewer: 1, // the one with less far to go makes this many fewer runs of it
  late: 0.1, // and sets off this much later, as a share of the period

  warm: 1, // periods run before the first frame is shown, so it opens on cells that have lived a little
  frame: 0.2, // radius of a cell on screen when it fuses, in screen heights
  zoomPulse: 0.25, // 0 = steady dive, towards 1 = lingers on each fusion
  axis: 0, // angle on screen of the line between two cells when they fuse, degrees
  lead: 0.3, // how far ahead the view looks, towards where the next pair will meet: 0 keeps each fusion dead centre
  zoomFast: false, // the dive in bursts: it holds on a fusion, then rushes to where the next one will be
  zoomAt: 0.62, // when in the period a burst is at its fastest
  zoomTakes: 0.18, // how much of the period it takes
  zoomCreep: 0.12, // the share of the dive that is still made slowly, in between
  zoomTwist: 1, // how much of the view's turning goes with the bursts
  rush: 1.6, // time itself runs this many times faster at the height of a burst
};

const TAU = Math.PI * 2;
// Math.hypot guards against overflow, and is several times slower for it
const hyp = (x: number, y: number) => Math.sqrt(x * x + y * y);
const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (a: number) => a - TAU * Math.round(a / TAU);

export function hash(n: number) {
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}
function mulberry(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// n points round an ellipse, evenly spaced along the curve, starting `offset` points past the +x tip
function ellipse(n: number, a: number, b: number, offset: number) {
  const M = 8192;
  const cum = new Float64Array(M + 1);
  let px = a,
    py = 0;
  for (let k = 1; k <= M; k++) {
    const x = a * Math.cos((k / M) * TAU),
      y = b * Math.sin((k / M) * TAU);
    cum[k] = cum[k - 1] + hyp(x - px, y - py);
    px = x;
    py = y;
  }
  const qx = new Float64Array(n),
    qy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let f = (i + offset) / n;
    f -= Math.floor(f);
    const s = f * cum[M];
    let lo = 0,
      hi = M;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const ang = ((lo + (s - cum[lo]) / (cum[hi] - cum[lo])) / M) * TAU;
    qx[i] = a * Math.cos(ang);
    qy[i] = b * Math.sin(ang);
  }
  return { qx, qy, length: cum[M] };
}

// One closed membrane, counter-clockwise, with a grid over its segments for finding the nearest one.
export class Loop {
  n: number;
  x: Float64Array;
  y: Float64Array;
  px: Float64Array;
  py: Float64Array;
  qx!: Float64Array; // the shape it rests in, for a cell of radius one
  qy!: Float64Array;
  mat: Float32Array; // where along its first owner each point was: patterns hang on this
  part: Uint8Array; // which of the two cells a fused membrane's point came from
  cox: Float64Array; // hairs: where their tips are from their roots
  coy: Float64Array;
  crn: Float32Array; // and per hair: place along its segment, length, phase
  cx = 0;
  cy = 0;
  ox = 0; // where the middle was a step ago
  oy = 0;
  vx = 0; // per step, through the fluid that holds it
  vy = 0;
  g00 = 0; // the flow round the middle, per step: speed there is g times place
  g01 = 0;
  g10 = 0;
  g11 = 0;
  ang = 0;

  private gx0 = 0;
  private gy0 = 0;
  private gs = 1;
  private gw = 0;
  private gh = 0;
  private head = new Int32Array(0);
  private next: Int32Array;
  private seg: Int32Array;
  // the last answer from nearest()
  hd = 0;
  hx = 0;
  hy = 0;
  hi = 0;
  ht = 0;
  hin = false;

  constructor(n: number) {
    this.n = n;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.mat = new Float32Array(n);
    this.part = new Uint8Array(n);
    this.cox = new Float64Array(n * CIL);
    this.coy = new Float64Array(n * CIL);
    this.crn = new Float32Array(n * CIL * 3);
    this.next = new Int32Array(n * 8);
    this.seg = new Int32Array(n * 8);
  }

  // Its middle, how it moved this step, and the turn that best lays the resting shape over it. The
  // move is a drift plus the flow that best fits its points: turning, stretching, squeezing. That flow
  // is laid out from where the middle was, so it can be applied to anything that hasn't moved yet.
  measure() {
    const { n, x, y, px, py, qx, qy } = this;
    let cx = 0,
      cy = 0,
      vx = 0,
      vy = 0;
    for (let i = 0; i < n; i++) {
      cx += x[i];
      cy += y[i];
      vx += x[i] - px[i];
      vy += y[i] - py[i];
    }
    cx /= n;
    cy /= n;
    vx /= n;
    vy /= n;
    const ox = cx - vx,
      oy = cy - vy;
    let a = 0,
      b = 0,
      sxx = 0,
      sxy = 0,
      syy = 0,
      uxx = 0,
      uxy = 0,
      uyx = 0,
      uyy = 0;
    for (let i = 0; i < n; i++) {
      const rx = px[i] - ox,
        ry = py[i] - oy;
      const ux = x[i] - px[i] - vx,
        uy = y[i] - py[i] - vy;
      sxx += rx * rx;
      sxy += rx * ry;
      syy += ry * ry;
      uxx += ux * rx;
      uxy += ux * ry;
      uyx += uy * rx;
      uyy += uy * ry;
      a += qx[i] * (x[i] - cx) + qy[i] * (y[i] - cy);
      b += qx[i] * (y[i] - cy) - qy[i] * (x[i] - cx);
    }
    this.cx = cx;
    this.cy = cy;
    this.ox = ox;
    this.oy = oy;
    this.vx = vx;
    this.vy = vy;
    const det = sxx * syy - sxy * sxy;
    if (det > 0) {
      this.g00 = (uxx * syy - uxy * sxy) / det;
      this.g01 = (uxy * sxx - uxx * sxy) / det;
      this.g10 = (uyx * syy - uyy * sxy) / det;
      this.g11 = (uyy * sxx - uyx * sxy) / det;
    } else this.g00 = this.g01 = this.g10 = this.g11 = 0;
    this.ang = Math.atan2(b, a);
  }

  area() {
    const { n, x, y } = this;
    let A = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) A += x[j] * y[i] - x[i] * y[j];
    return A / 2;
  }

  grid(size: number) {
    const { n, x, y } = this;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      if (x[i] < x0) x0 = x[i];
      if (x[i] > x1) x1 = x[i];
      if (y[i] < y0) y0 = y[i];
      if (y[i] > y1) y1 = y[i];
    }
    const most = 160;
    const gs = Math.max(size, (x1 - x0) / most, (y1 - y0) / most);
    const gw = Math.floor((x1 - x0) / gs) + 1,
      gh = Math.floor((y1 - y0) / gs) + 1;
    if (this.head.length < gw * gh) this.head = new Int32Array(gw * gh * 2);
    this.head.fill(-1, 0, gw * gh);
    let used = 0;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const ax = x[i] < x[j] ? x[i] : x[j],
        bx = x[i] < x[j] ? x[j] : x[i];
      const ay = y[i] < y[j] ? y[i] : y[j],
        by = y[i] < y[j] ? y[j] : y[i];
      const c0 = Math.floor((ax - x0) / gs),
        c1 = Math.min(gw - 1, Math.floor((bx - x0) / gs));
      const r0 = Math.floor((ay - y0) / gs),
        r1 = Math.min(gh - 1, Math.floor((by - y0) / gs));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          if (used === this.seg.length) {
            const seg = new Int32Array(used * 2),
              next = new Int32Array(used * 2);
            seg.set(this.seg);
            next.set(this.next);
            this.seg = seg;
            this.next = next;
          }
          this.seg[used] = i;
          this.next[used] = this.head[r * gw + c];
          this.head[r * gw + c] = used++;
        }
    }
    this.gx0 = x0;
    this.gy0 = y0;
    this.gs = gs;
    this.gw = gw;
    this.gh = gh;
  }

  // The nearest point of the membrane within `reach`, and which side of it the asker is on. With `self`
  // set it is one of the membrane's own points asking, and the stretch either side of it doesn't count.
  nearest(qx: number, qy: number, reach: number, self = -1) {
    const { n, x, y, gs, gw, gh, head, next, seg } = this;
    let c0 = Math.floor((qx - reach - this.gx0) / gs),
      c1 = Math.floor((qx + reach - this.gx0) / gs);
    let r0 = Math.floor((qy - reach - this.gy0) / gs),
      r1 = Math.floor((qy + reach - this.gy0) / gs);
    if (c0 < 0) c0 = 0;
    if (r0 < 0) r0 = 0;
    if (c1 >= gw) c1 = gw - 1;
    if (r1 >= gh) r1 = gh - 1;
    let best = reach * reach,
      bi = -1,
      bt = 0;
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        for (let e = head[r * gw + c]; e >= 0; e = next[e]) {
          const i = seg[e];
          const j = i + 1 === n ? 0 : i + 1;
          if (self >= 0) {
            let d = i - self;
            if (d > n / 2) d -= n;
            else if (d < -n / 2) d += n;
            if (d > -11 && d < 10) continue;
          }
          const ex = x[j] - x[i],
            ey = y[j] - y[i];
          const ee = ex * ex + ey * ey;
          let t = ee > 0 ? ((qx - x[i]) * ex + (qy - y[i]) * ey) / ee : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = qx - x[i] - t * ex,
            dy = qy - y[i] - t * ey;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) {
            best = d2;
            bi = i;
            bt = t;
          }
        }
    if (bi < 0) return false;
    const i = bi,
      j = i + 1 === n ? 0 : i + 1;
    const ex = x[j] - x[i],
      ey = y[j] - y[i];
    this.hi = i;
    this.ht = bt;
    this.hx = x[i] + bt * ex;
    this.hy = y[i] + bt * ey;
    this.hd = Math.sqrt(best);
    if (bt > 0 && bt < 1) this.hin = ex * (qy - y[i]) - ey * (qx - x[i]) > 0;
    else {
      // nearest to a corner: inside if the corner points inwards
      const v = bt <= 0 ? i : j;
      const a = v === 0 ? n - 1 : v - 1,
        b = v + 1 === n ? 0 : v + 1;
      const e1x = x[v] - x[a],
        e1y = y[v] - y[a],
        e2x = x[b] - x[v],
        e2y = y[b] - y[v];
      const cr = e1x * e2y - e1y * e2x;
      if (Math.abs(cr) < 1e-4 * Math.sqrt((e1x * e1x + e1y * e1y) * (e2x * e2x + e2y * e2y))) this.hin = e2x * (qy - y[v]) - e2y * (qx - x[v]) > 0;
      else this.hin = cr < 0;
    }
    return true;
  }
}

// Keep a point at least r inside a membrane (or, with out, outside it). `share` of the push goes to the
// point, the rest to the membrane.
function hold(L: Loop, X: Float64Array, Y: Float64Array, k: number, r: number, reach: number, share: number, out: boolean, self = -1, shy = false) {
  if (!L.nearest(X[k], Y[k], reach, self)) return;
  const d = L.hd;
  const right = L.hin !== out;
  // A membrane against itself only keeps two walls apart that face each other across water. Seen from
  // within, the nearest wall is the far side of the pore, and that is no business of this. The same
  // goes for a big body's points against a small one (shy): found inside it, they would be thrown out
  // through its far side, and the big body would wrap round the small. The small one's points are
  // thrown out of the big one instead.
  if ((self >= 0 || shy) && !right) return;
  if (right && d >= r) return;
  const i = L.hi,
    j = i + 1 === L.n ? 0 : i + 1,
    t = L.ht;
  let nx: number, ny: number;
  if (d > 1e-12 * r + 1e-300) {
    nx = (X[k] - L.hx) / d;
    ny = (Y[k] - L.hy) / d;
    if (!right) {
      nx = -nx;
      ny = -ny;
    }
  } else {
    const ex = L.x[j] - L.x[i],
      ey = L.y[j] - L.y[i],
      el = hyp(ex, ey) || 1;
    nx = (out ? ey : -ey) / el;
    ny = (out ? -ex : ex) / el;
  }
  const pen = right ? r - d : r + d;
  // The membrane's two points never move more than part of their own spacing for one contact: one
  // point deep where it shouldn't be would otherwise tear a notch in it. The point takes the rest.
  const ex = L.x[j] - L.x[i],
    ey = L.y[j] - L.y[i];
  const rest = Math.min(pen * (1 - share), 0.5 * Math.sqrt(ex * ex + ey * ey));
  X[k] += nx * (pen - rest);
  Y[k] += ny * (pen - rest);
  L.x[i] -= nx * rest * (1 - t);
  L.y[i] -= ny * rest * (1 - t);
  L.x[j] -= nx * rest * t;
  L.y[j] -= ny * rest * t;
}

// The same for a whole lodger: its middle is kept r inside or outside a membrane, and it is moved
// bodily. The rules above only shape a contact; two bodies already deep in each other they would
// knot together, so this is what keeps bodies apart.
function stay(L: Loop, lod: Lodger, r: number, reach: number, out: boolean) {
  const dl = lod.loop;
  if (!L.nearest(dl.cx, dl.cy, reach)) return;
  const d = L.hd,
    right = L.hin !== out;
  if (right && d >= r) return;
  if (d < 1e-9 * r) return;
  const pen = right ? r - d : r + d,
    sign = right ? 1 : -1;
  const sx = (sign * (dl.cx - L.hx) * pen) / d,
    sy = (sign * (dl.cy - L.hy) * pen) / d;
  for (let i = 0; i < dl.n; i++) {
    dl.x[i] += sx;
    dl.y[i] += sy;
  }
  dl.cx += sx;
  dl.cy += sy;
}

// kinds of thing inside a cell
export const STAR = 0, // a vacuole that fills and empties, with canals round it
  FOOD = 1,
  BUBBLE = 2,
  DROP = 3,
  GRAIN = 4,
  DUST = 5;

export interface Bits {
  n: number;
  x: Float64Array;
  y: Float64Array;
  px: Float64Array;
  py: Float64Array;
  r: Float32Array; // for a cell of radius one
  kind: Uint8Array;
  seed: Float32Array;
  hx: Float32Array; // its place in the cell, in the cell's own frame, for a cell of radius one
  hy: Float32Array;
}
function bits(n: number): Bits {
  return {
    n,
    x: new Float64Array(n),
    y: new Float64Array(n),
    px: new Float64Array(n),
    py: new Float64Array(n),
    r: new Float32Array(n),
    kind: new Uint8Array(n),
    seed: new Float32Array(n),
    hx: new Float32Array(n),
    hy: new Float32Array(n),
  };
}
function join(a: Bits, b: Bits) {
  const c = bits(a.n + b.n);
  for (const k of ["x", "y", "px", "py", "r", "kind", "seed", "hx", "hy"] as const) {
    (c[k] as Float64Array).set(a[k] as Float64Array);
    (c[k] as Float64Array).set(b[k] as Float64Array, a.n);
  }
  return c;
}

// Lodgers: cell-like things that live in a cell's fluid, soft bodies in their own right
export const JELLY = 0,
  ALGA = 1,
  ROD = 2;
export interface Lodger {
  loop: Loop;
  S: number; // its radius
  r: number; // the same, for a cell of radius one
  kind: number;
  seed: number;
  hx: number; // its place, as a Bits' hx and hy
  hy: number;
  edge: number; // length of one segment at rest, area at rest, and furthest point from the middle: for radius one
  room: number;
  reach: number;
}

// A kind of cell. The generations take turns: a cell of one kind holds a cell of the next.
export interface Species {
  id: number;
  AX: number; // half its length and half its width, for a cell of radius one
  BX: number;
  rest1: ReturnType<typeof ellipse>; // the shape of one at rest, and of two fused
  rest2: ReturnType<typeof ellipse>;
  edge1: number;
  edge2: number;
  plan: Plan[][]; // what it holds, for each of the two of a pair
  hair: number; // its hairs: how long, what share of them it has at all, how much they swing
  hairShare: number;
  hairSwing: number;
}

export interface Body {
  g: number; // its generation
  sp: Species;
  side: number; // 0 and 1 are the two of a pair, 2 is the pair fused
  S: number; // radius of a single cell of its generation
  loop: Loop;
  org: Bits;
  dust: Bits;
  lodgers: Lodger[];
  kids: Body[];
  parent: Body | null;
  fused: number; // the step its membrane became one, or -1
  ax: number; // its own swimming, this step
  ay: number;
  turnTo: number;
  since: number; // the step from which its contents have had their places
  aim: number; // which way it is swimming
  pulse: number; // how stretched along its length: over one in a lunge, under as it gathers
  wave: number; // a squeeze running tailwards along it as it lunges: how deep, and where along it is
  waveAt: number;
  thrust: number; // how hard it is lunging, 0..1
}
export interface Gen {
  g: number;
  bodies: Body[];
  merged: boolean;
}

type Plan = { x: number; y: number; r: number; kind: number; seed: number }[];

// Move a set of points with a flow: where they were moves too, so the flow gives them no speed of
// their own.
function carry(L: Loop, x: Float64Array, y: Float64Array, px: Float64Array, py: Float64Array, n: number, sign = 1, alsoNow = true) {
  const { ox, oy, vx, vy, g00, g01, g10, g11 } = L;
  for (let i = 0; i < n; i++) {
    const rx = x[i] - ox,
      ry = y[i] - oy;
    const dx = sign * (vx + g00 * rx + g01 * ry),
      dy = sign * (vy + g10 * rx + g11 * ry);
    if (alsoNow) {
      x[i] += dx;
      y[i] += dy;
    }
    px[i] += dx;
    py[i] += dy;
  }
}

export class Sim {
  step = 0;
  TS: number;
  h: number;
  gens: Gen[] = [];
  kinds: Species[] = [];
  theta: number;
  beats: number;
  scratch = new Float64Array(N * 8);
  rooms = new Float64Array(3 * 16);
  roomCount = 0;
  healed = 0; // lodgers that had to be put back in shape: should stay at nothing once it has settled
  shapes: {
    qx: Float64Array;
    qy: Float64Array;
    edge: number;
    room: number;
    reach: number;
  }[] = [];
  renormed = 0; // times the world has been rescaled: lets a viewer keep its own state in step

  constructor() {
    this.h = 1 / P.hz;
    this.TS = Math.round(P.period * P.hz);
    this.theta = (P.turn * Math.PI) / 180;
    this.beats = Math.max(1, Math.round(P.beat * P.period));
    const count = clamp(Math.round(P.species), 1, 2);
    for (let id = 0; id < count; id++) {
      const AX = Math.sqrt(id ? P.aspect2 : P.aspect),
        BX = 1 / AX;
      const rest1 = ellipse(N, AX, BX, 0);
      // fused: the two points where the membranes joined end up at the tips
      const rest2 = ellipse(2 * N, AX * Math.SQRT2, BX * Math.SQRT2, 0.5);
      this.kinds.push({
        id,
        AX,
        BX,
        rest1,
        rest2,
        edge1: rest1.length / N,
        edge2: rest2.length / (2 * N),
        plan: [],
        hair: id ? P.hair2 : P.hair,
        hairShare: id ? P.hairShare2 : 1,
        hairSwing: id ? 0.4 : 1,
      });
    }
    // what lodgers look like at rest: two roundish, and a rod with round ends
    const rod = () => {
      const half = 0.95,
        r = 0.5;
      const all = 4 * half + TAU * r;
      const qx = new Float64Array(BN),
        qy = new Float64Array(BN);
      for (let i = 0; i < BN; i++) {
        let d = ((i + 0.5) / BN) * all;
        if (d < Math.PI * r) {
          qx[i] = half + r * Math.sin(d / r);
          qy[i] = -r * Math.cos(d / r);
        } else if ((d -= Math.PI * r) < 2 * half) {
          qx[i] = half - d;
          qy[i] = r;
        } else if ((d -= 2 * half) < Math.PI * r) {
          qx[i] = -half - r * Math.sin(d / r);
          qy[i] = r * Math.cos(d / r);
        } else {
          qx[i] = -half + (d - Math.PI * r);
          qy[i] = -r;
        }
      }
      return { qx, qy };
    };
    this.shapes = [ellipse(BN, 1.04, 0.96, 0), ellipse(BN, 1.14, 0.88, 0), rod()].map(({ qx, qy }) => {
      let edge = 0,
        room = 0,
        reach = 0;
      for (let i = 0, j = BN - 1; i < BN; j = i++) {
        edge += hyp(qx[i] - qx[j], qy[i] - qy[j]) / BN;
        room += (qx[j] * qy[i] - qx[i] * qy[j]) / 2;
        reach = Math.max(reach, hyp(qx[i], qy[i]));
      }
      return { qx, qy, edge, room, reach };
    });
    for (const sp of this.kinds) sp.plan = [this.layout(sp, 0), this.layout(sp, 1)];
    this.begin();
  }

  // which kind of cell generation g is
  kind(g: number) {
    const n = this.kinds.length;
    return this.kinds[((g % n) + n) % n];
  }
  // steps after which the picture is the same one again, deeper
  get loop() {
    return this.TS * this.kinds.length;
  }

  // Where in a cell its inner cell rides until the cell fuses, for a cell of radius one: off the
  // middle, towards the side away from the other cell, and not alike in the two of a pair.
  rideAt(sp: Species, side: number) {
    return side ? [0.9 * P.ride * sp.AX, -0.4 * P.ride * sp.BX] : [-P.ride * sp.AX, -0.45 * P.ride * sp.BX];
  }

  // What a cell holds and where, the same for every generation, different for the two of a pair
  layout(sp: Species, side: number) {
    const rnd = mulberry((side ? 9173 : 4241) + sp.id * 7717);
    const { AX, BX } = sp;
    const inner = this.kinds[(sp.id + 1) % this.kinds.length];
    const [rx, ry] = this.rideAt(sp, side);
    const org: Plan = [];
    let taken: Plan = [];
    const fits = (x: number, y: number, r: number, loose: boolean) => {
      const m = r + 0.05;
      if ((x / (AX - m)) ** 2 + (y / (BX - m)) ** 2 > 1) return false;
      if (((x - rx) / (inner.AX / K + r + 0.07)) ** 2 + ((y - ry) / (inner.BX / K + r + 0.07)) ** 2 < 1) return false;
      if (!loose) for (const o of org) if (hyp(o.x - x, o.y - y) < (o.r + r) * 1.08) return false;
      for (const o of taken) if (hyp(o.x - x, o.y - y) < o.r + r) return false;
      return true;
    };
    const place = (kind: number, r: number, x0?: number, y0?: number) => {
      for (let tries = 0; tries < 600; tries++) {
        const x = x0 !== undefined && tries < 40 ? x0 + (rnd() - 0.5) * 0.12 : (rnd() * 2 - 1) * AX;
        const y = y0 !== undefined && tries < 40 ? y0 + (rnd() - 0.5) * 0.12 : (rnd() * 2 - 1) * BX;
        if (fits(x, y, r, false)) {
          org.push({ x, y, r, kind, seed: rnd() });
          return;
        }
      }
    };
    // the lodgers take their room first, and the rest fit round them
    // Three on the side that will face the other cell (+y): when the two fuse, those are strung along
    // the middle of the pair, between the two inner cells. The other two keep to the end the inner
    // cell isn't riding at. The two kinds of cell keep different company.
    const seats = side
      ? [
          [ALGA, P.seatSize * 0.93, -P.seatShift, 0.44],
          [JELLY, 0.17, 0.62, 0.37],
          [ROD, 0.14, -0.66, 0.33],
          [JELLY, 0.13, -0.25, -0.5],
          [ALGA, 0.12, -0.72, -0.34],
        ]
      : [
          [JELLY, P.seatSize, P.seatShift, 0.44],
          [ALGA, 0.16, -0.62, 0.36],
          [ROD, 0.14, 0.66, 0.34],
          [ALGA, 0.135, 0.4, -0.48],
          [JELLY, 0.12, 0.84, -0.2],
        ];
    const other = [ALGA, JELLY, ROD];
    for (const [kind, r, x, y] of seats.slice(0, P.lodgers)) place(sp.id ? other[kind] : kind, r, (x * AX) / 1.2845, (y * BX) / 0.7785);
    const lodgers = org.splice(0);
    taken = lodgers.map((o) => ({ ...o, r: o.r * 1.1 }));
    if (sp.id) {
      // the round kind: one big nucleus, green bodies, a few drops
      place(STAR, 0.135, AX * 0.42, (side ? 1 : -1) * 0.2);
      for (let i = 0; i < 7; i++) place(FOOD, 0.06 + 0.045 * rnd());
      for (let i = 0; i < 3; i++) place(BUBBLE, 0.035 + 0.03 * rnd());
      for (let i = 0; i < 9; i++) place(DROP, 0.016 + 0.018 * rnd());
      for (let i = 0; i < 16; i++) place(GRAIN, 0.011 + 0.009 * rnd());
    } else {
      place(STAR, 0.085, AX * 0.6, (side ? -1 : 1) * 0.1);
      place(STAR, 0.08, -AX * 0.56, (side ? 1 : -1) * 0.12);
      for (let i = 0; i < 4; i++) place(FOOD, 0.055 + 0.04 * rnd());
      for (let i = 0; i < 6; i++) place(BUBBLE, 0.035 + 0.035 * rnd());
      for (let i = 0; i < 14; i++) place(DROP, 0.018 + 0.022 * rnd());
      for (let i = 0; i < 12; i++) place(GRAIN, 0.011 + 0.009 * rnd());
    }
    const dust: Plan = [];
    while (dust.length < 640) {
      const x = (rnd() * 2 - 1) * AX,
        y = (rnd() * 2 - 1) * BX;
      const r = 0.003 + 0.009 * rnd() ** 3;
      if (fits(x, y, r - 0.03, true)) dust.push({ x, y, r, kind: DUST, seed: rnd() });
    }
    return [org, dust, lodgers];
  }

  // Lay a plan out in a body as it now lies, at rest in it
  fill(L: Loop, S: number, list: Plan, squash = 1, lift = 0, widen = 1) {
    const c = Math.cos(L.ang),
      s = Math.sin(L.ang);
    const b = bits(list.length);
    list.forEach((o, k) => {
      const lx = o.x * widen,
        ly = o.y * squash + lift;
      b.x[k] = b.px[k] = L.cx + S * (c * lx - s * ly);
      b.y[k] = b.py[k] = L.cy + S * (s * lx + c * ly);
      b.r[k] = o.r;
      b.kind[k] = o.kind;
      b.seed[k] = o.seed;
      b.hx[k] = lx;
      b.hy[k] = ly;
    });
    return b;
  }

  // The lodgers of a plan, in a body as it now lies
  lodge(L: Loop, S: number, list: Plan, squash = 1, lift = 0, widen = 1): Lodger[] {
    const c = Math.cos(L.ang),
      s = Math.sin(L.ang);
    return list.map((o) => {
      const shape = this.shapes[o.kind];
      const loop = new Loop(BN);
      loop.qx = shape.qx;
      loop.qy = shape.qy;
      const lx = o.x * widen,
        ly = o.y * squash + lift;
      const cx = L.cx + S * (c * lx - s * ly),
        cy = L.cy + S * (s * lx + c * ly);
      const turn = L.ang + (o.kind === ROD ? (o.seed - 0.5) * 0.5 : o.seed * TAU),
        rs = o.r * S;
      for (let i = 0; i < BN; i++) {
        loop.x[i] = loop.px[i] = cx + rs * (Math.cos(turn) * shape.qx[i] - Math.sin(turn) * shape.qy[i]);
        loop.y[i] = loop.py[i] = cy + rs * (Math.sin(turn) * shape.qx[i] + Math.cos(turn) * shape.qy[i]);
      }
      loop.measure();
      loop.grid(3 * shape.edge * rs);
      return {
        loop,
        S: rs,
        r: o.r,
        kind: o.kind,
        seed: o.seed,
        hx: lx,
        hy: ly,
        edge: shape.edge,
        room: shape.room,
        reach: shape.reach,
      };
    });
  }

  body(side: number, S: number, L: Loop, g: number): Body {
    const sp = this.kind(g);
    L.measure();
    for (let i = 0; i < L.n * CIL; i++) {
      const id = (side * 4 * N + i) * 3;
      L.crn[i * 3] = ((i % CIL) + hash(id + 1)) / CIL;
      // the round kind has only some of its hairs, all much of a length
      const long = sp.id ? 0.8 + 0.4 * hash(id) : 0.55 + 0.75 * hash(id) + (hash(id + 7) > 0.93 ? 0.55 : 0);
      L.crn[i * 3 + 1] = hash(id + 11) < sp.hairShare ? long : 0;
      L.crn[i * 3 + 2] = hash(id + 2) * TAU;
    }
    return {
      g,
      sp,
      side,
      S,
      loop: L,
      org: bits(0),
      dust: bits(0),
      lodgers: [],
      kids: [],
      parent: null,
      fused: -1,
      ax: 0,
      ay: 0,
      turnTo: NaN,
      since: this.step,
      aim: NaN,
      pulse: 1,
      thrust: 0,
      wave: 0,
      waveAt: 0,
    };
  }

  // A cell at rest in whatever holds it
  cell(side: number, S: number, cx: number, cy: number, heading: number, dusty: boolean, g: number) {
    const sp = this.kind(g);
    const L = new Loop(N);
    const c = Math.cos(heading),
      s = Math.sin(heading);
    L.qx = sp.rest1.qx;
    L.qy = sp.rest1.qy;
    for (let i = 0; i < N; i++) {
      L.x[i] = L.px[i] = cx + S * (c * L.qx[i] - s * L.qy[i]);
      L.y[i] = L.py[i] = cy + S * (s * L.qx[i] + c * L.qy[i]);
      L.mat[i] = i;
    }
    const b = this.body(side, S, L, g);
    b.org = this.fill(L, S, sp.plan[side][0]);
    if (dusty) {
      b.dust = this.fill(L, S, sp.plan[side][1]);
      b.lodgers = this.lodge(L, S, sp.plan[side][2]);
    }
    return b;
  }

  // Only for the outermost body at the start: an already fused cell at rest
  fusedCell(S: number, heading: number, g: number) {
    const sp = this.kind(g);
    const L = new Loop(2 * N);
    const c = Math.cos(heading),
      s = Math.sin(heading);
    L.qx = sp.rest2.qx;
    L.qy = sp.rest2.qy;
    for (let i = 0; i < 2 * N; i++) {
      L.x[i] = L.px[i] = S * (c * L.qx[i] - s * L.qy[i]);
      L.y[i] = L.py[i] = S * (s * L.qx[i] + c * L.qy[i]);
      L.mat[i] = i % N;
      L.part[i] = i < N ? 0 : 1;
    }
    const b = this.body(2, S, L, g);
    b.fused = -1e9;
    const lift = 0.706 * sp.BX;
    const half = (which: number) => join(this.fill(L, S, sp.plan[0][which], 0.5, lift, 1.25), this.fill(L, S, sp.plan[1][which], 0.5, -lift, 1.25));
    b.org = half(0);
    b.dust = half(1);
    b.lodgers = [...this.lodge(L, S, sp.plan[0][2], 0.5, lift, 1.25), ...this.lodge(L, S, sp.plan[1][2], 0.5, -lift, 1.25)];
    return b;
  }

  age(G: Gen) {
    return this.step / this.TS - G.g;
  }
  gen(g: number) {
    return this.gens.find((G) => G.g === g);
  }

  // half the distance between the middles of two cells closing on each other, in their radii
  near(sp: Species, v: number) {
    return sp.BX + mix(P.gapFar, P.gapNear, smooth(P.contactAt - 0.1, 0.98, v)) / 2 - P.press * smooth(P.contactAt, 1, v);
  }
  // Where the two of generation g meet, from the middle of the cell that holds them, in their own
  // radii: off to one side, so each dive goes in somewhere else than the last.
  offset(g: number) {
    const a = this.theta * (g - 1);
    const across = P.offAcross * K,
      along = P.offAlong * K;
    return [across * Math.cos(a) - along * Math.sin(a), across * Math.sin(a) + along * Math.cos(a)];
  }

  begin() {
    // a fused cell holding a pair about to fuse, each holding a cell, holding a cell, holding a cell
    const root = this.fusedCell(K, -this.theta + Math.PI / 2, -1);
    this.gens.push({ g: -1, bodies: [root], merged: true });
    const rho = this.near(this.kind(0), 1);
    const [ox, oy] = this.offset(0);
    let pair = [0, 1].map((side) => {
      const sign = side ? -1 : 1;
      const b = this.cell(side, 1, ox + sign * rho, oy, sign * (Math.PI / 2), true, 0);
      b.parent = root;
      return b;
    });
    root.kids = pair;
    this.gens.push({ g: 0, bodies: pair, merged: false });
    for (let g = 1; g <= -BORN - 1; g++) {
      pair = pair.map((p) => this.child(p, g, g <= -DUSTY));
      this.gens.push({ g, bodies: pair, merged: false });
    }
    this.events();
  }

  child(p: Body, g: number, dusty = false) {
    const L = p.loop;
    L.measure();
    const [rx, ry] = this.rideAt(p.sp, p.side);
    const c = Math.cos(L.ang),
      s = Math.sin(L.ang);
    const b = this.cell(p.side, p.S / K, L.cx + p.S * (c * rx - s * ry), L.cy + p.S * (s * rx + c * ry), L.ang, dusty, g);
    b.parent = p;
    p.kids = [b];
    return b;
  }

  events() {
    if (this.step % this.TS) return;
    const k = this.step / this.TS;
    const fusing = this.gen(k);
    if (fusing && !fusing.merged) this.fuse(fusing);
    const youngest = this.gen(k - BORN - 1);
    if (youngest && !this.gen(k - BORN))
      this.gens.push({
        g: k - BORN,
        bodies: youngest.bodies.map((p) => this.child(p, k - BORN)),
        merged: false,
      });
    const dusty = this.gen(k - DUSTY);
    if (dusty)
      for (const b of dusty.bodies)
        if (!b.dust.n) {
          b.loop.measure();
          b.dust = this.fill(b.loop, b.S, b.sp.plan[b.side][1]);
          b.lodgers = this.lodge(b.loop, b.S, b.sp.plan[b.side][2]);
        }
    const oldest = this.gen(k - DIES);
    if (oldest) {
      this.gens = this.gens.filter((G) => G !== oldest);
      for (const b of this.gens[0].bodies) b.parent = null;
      this.renorm();
    }
  }

  // The membranes become one. Both run counter-clockwise, so where they face each other they run in
  // opposite directions: cut each once, and join the ends across.
  fuse(G: Gen) {
    const [A, B] = G.bodies;
    const a = A.loop,
      b = B.loop;
    let best = Infinity,
      bi = 0,
      bj = 0;
    for (let i = 0; i < N; i++) {
      const i1 = (i + 1) % N;
      const mx = a.x[i] + a.x[i1],
        my = a.y[i] + a.y[i1];
      for (let j = 0; j < N; j++) {
        const j1 = (j + 1) % N;
        const d = (mx - b.x[j] - b.x[j1]) ** 2 + (my - b.y[j] - b.y[j1]) ** 2;
        if (d < best) {
          best = d;
          bi = i;
          bj = j;
        }
      }
    }
    const L = new Loop(2 * N);
    L.qx = A.sp.rest2.qx;
    L.qy = A.sp.rest2.qy;
    const take = (from: Loop, first: number, at: number, part: number) => {
      for (let m = 0; m < N; m++) {
        const s = (first + m) % N,
          d = at + m;
        L.x[d] = from.x[s];
        L.y[d] = from.y[s];
        L.px[d] = from.px[s];
        L.py[d] = from.py[s];
        L.mat[d] = from.mat[s];
        L.part[d] = part;
        for (let k = 0; k < CIL; k++) {
          L.cox[d * CIL + k] = from.cox[s * CIL + k];
          L.coy[d * CIL + k] = from.coy[s * CIL + k];
          for (let q = 0; q < 3; q++) L.crn[(d * CIL + k) * 3 + q] = from.crn[(s * CIL + k) * 3 + q];
        }
      }
    };
    take(a, bi + 1, 0, 0);
    take(b, bj + 1, N, 1);
    a.measure();
    b.measure();
    L.measure();
    // What each held was at rest in it; now it is held by the pair, so it keeps the speed its own cell
    // had over that of the two together.
    for (const from of G.bodies) {
      for (const set of [from.org, from.dust, ...from.kids.map((kid) => kid.loop), ...from.lodgers.map((d) => d.loop)]) {
        carry(from.loop, set.x, set.y, set.px, set.py, set.n, -1, false);
        carry(L, set.x, set.y, set.px, set.py, set.n, 1, false);
      }
    }
    // And each thing's place in its cell becomes a place in its cell's half of the pair: the disc it
    // lived in is laid onto half a disc, the side that faced the other cell along the middle.
    const mc = Math.cos(L.ang),
      ms = Math.sin(L.ang);
    const { AX, BX } = A.sp;
    for (const from of G.bodies) {
      const fl = from.loop;
      const fc = Math.cos(fl.ang),
        fs = Math.sin(fl.ang);
      const local = (wx: number, wy: number) => [((wx - L.cx) * mc + (wy - L.cy) * ms) / A.S, (-(wx - L.cx) * ms + (wy - L.cy) * mc) / A.S];
      const [ox, oy] = local(fl.cx, fl.cy);
      const up = oy >= 0 ? 1 : -1;
      const turn = this.swirlAt(from);
      // where a place is now, swirl and all, in the pair's frame, and from there into its half
      const move = (px: number, py: number, turned = true) => {
        const nx = px / AX,
          ny = py / BX;
        const hx = turned ? AX * (nx * turn[0] - ny * turn[1]) : px,
          hy = turned ? BX * (nx * turn[1] + ny * turn[0]) : py;
        const [lx, ly] = local(fl.cx + A.S * (fc * hx - fs * hy), fl.cy + A.S * (fs * hx + fc * hy));
        let p = (lx - ox) / AX,
          q = (up * (ly - oy)) / BX;
        const far = hyp(p, q);
        if (far > 0.97) {
          p *= 0.97 / far;
          q *= 0.97 / far;
        }
        const Q = (q + 1) / 2;
        const P_ = (p * Math.sqrt(1 - Q * Q)) / Math.sqrt(1 - q * q);
        return [Math.SQRT2 * AX * P_ * 0.94, up * Math.SQRT2 * BX * (0.04 + Q * 0.9)];
      };
      for (const set of [from.org, from.dust]) for (let i = 0; i < set.n; i++) [set.hx[i], set.hy[i]] = move(set.hx[i], set.hy[i]);
      for (const lod of from.lodgers) [lod.hx, lod.hy] = move(lod.hx, lod.hy, false);
    }
    const M: Body = {
      g: G.g,
      sp: A.sp,
      side: 2,
      S: A.S,
      loop: L,
      org: join(A.org, B.org),
      dust: join(A.dust, B.dust),
      lodgers: [...A.lodgers, ...B.lodgers],
      kids: [...A.kids, ...B.kids],
      parent: A.parent,
      fused: this.step,
      ax: 0,
      ay: 0,
      turnTo: NaN,
      since: this.step,
      aim: NaN,
      pulse: 1,
      thrust: 0,
      wave: 0,
      waveAt: 0,
    };
    for (const kid of M.kids) kid.parent = M;
    if (M.parent) M.parent.kids = [M];
    G.bodies = [M];
    G.merged = true;
  }

  // Everything K times bigger, about the outermost body's middle: the numbers stay near one for ever
  renorm() {
    const root = this.gens[0].bodies[0].loop;
    root.measure();
    const ox = root.cx,
      oy = root.cy;
    const grow = (x: Float64Array, y: Float64Array, n: number) => {
      for (let i = 0; i < n; i++) {
        x[i] = (x[i] - ox) * K;
        y[i] = (y[i] - oy) * K;
      }
    };
    for (const G of this.gens)
      for (const b of G.bodies) {
        const L = b.loop;
        grow(L.x, L.y, L.n);
        grow(L.px, L.py, L.n);
        for (let i = 0; i < L.n * CIL; i++) {
          L.cox[i] *= K;
          L.coy[i] *= K;
        }
        grow(b.org.x, b.org.y, b.org.n);
        grow(b.org.px, b.org.py, b.org.n);
        grow(b.dust.x, b.dust.y, b.dust.n);
        grow(b.dust.px, b.dust.py, b.dust.n);
        for (const d of b.lodgers) {
          grow(d.loop.x, d.loop.y, BN);
          grow(d.loop.px, d.loop.py, BN);
          d.S *= K;
          d.loop.measure();
        }
        b.S *= K;
        L.measure();
      }
    this.renormed++;
  }

  // Where each cell means to be. Before its parents fuse it rides at the middle of its own; after, the
  // two swing round each other, closing in. All of it is within what holds them: a cell's speed here
  // is its speed through its parent's fluid.
  control(G: Gen) {
    const a = this.age(G);
    const om = P.follow * this.h,
      os = P.followSwim * this.h;
    for (const b of G.bodies) {
      b.ax = b.ay = 0;
      b.turnTo = NaN;
      b.pulse = 1;
      b.thrust = 0;
      b.wave = 0;
    }
    if (G.merged) return;
    const [A] = G.bodies;
    if (a < -1) {
      // riding in its own cell, a little off the middle
      for (const b of G.bodies) {
        const q = b.parent!,
          p = q.loop,
          L = b.loop;
        const [rx, ry] = this.rideAt(q.sp, q.side);
        const c = Math.cos(p.ang),
          s = Math.sin(p.ang);
        b.ax = om * om * (p.cx + q.S * (c * rx - s * ry) - L.cx) - 2 * om * L.vx;
        b.ay = om * om * (p.cy + q.S * (s * rx + c * ry) - L.cy) - 2 * om * L.vy;
        b.turnTo = p.ang;
      }
      return;
    }
    const u = a + 1;
    // They swim about the middle of what holds them. Left to keep a middle of their own, every shove
    // from a lodger would move it for good, and no two periods would be alike.
    const p = A.parent!.loop;
    for (const b of G.bodies) {
      const L = b.loop;
      const [tx, ty, heading, lunge, gather, beat] = this.course(G.g, u, b.S, b.side);
      b.ax = os * os * (p.cx + tx - L.cx) - 2 * os * L.vx;
      b.ay = os * os * (p.cy + ty - L.cy) - 2 * os * L.vy;
      b.aim = b.turnTo = heading;
      b.pulse = 1 + P.stretch * (lunge - 0.7 * gather);
      b.thrust = lunge;
      b.wave = P.squeeze * Math.sqrt(lunge);
      b.waveAt = (beat - Math.floor(beat)) * 2.2;
    }
  }

  // The way one cell of a pair swims to the other, as bacteria and ciliates do it: straight runs along
  // its own length, and turns only in the pauses between, after backing up a little. The runs zigzag
  // in, and the last one slides in alongside the other cell, so the two end side by side. They meet
  // off the middle of the cell that holds them, so one has further to go than the other: the nearer
  // sets off later and makes fewer runs of it. Where it should be (from that middle), which way it
  // points, and where it is in its stroke.
  course(g: number, u: number, S: number, side: number) {
    const sp = this.kind(g),
      psp = this.kind(g - 1);
    const sign = side ? -1 : 1,
      about = side ? Math.PI : 0;
    const from = this.theta * (g - 1),
      to = this.theta * g;
    const cs = Math.cos(to),
      sn = Math.sin(to);
    const [ox, oy] = this.offset(g);
    if (u >= P.contactAt) {
      const d = sign * this.near(sp, u);
      return [(ox + d * cs) * S, (oy + d * sn) * S, to + Math.PI / 2 + about, 0, 0, 0];
    }
    // from where it rode in its own cell, to beside the other
    const cf = Math.cos(from),
      sf = Math.sin(from);
    const far = K * this.near(psp, 1),
      end = this.near(sp, P.contactAt);
    const span = (sd: number) => {
      const sg = sd ? -1 : 1,
        hd = from + Math.PI / 2 + (sd ? Math.PI : 0);
      const [rx, ry] = this.rideAt(psp, sd);
      return [sg * far * cf + K * (rx * Math.cos(hd) - ry * Math.sin(hd)), sg * far * sf + K * (rx * Math.sin(hd) + ry * Math.cos(hd)), ox + sg * end * cs, oy + sg * end * sn];
    };
    const [x0, y0, x1, y1] = span(side),
      his = span(1 - side);
    const nearer = hyp(x1 - x0, y1 - y0) < hyp(his[2] - his[0], his[3] - his[1]) - 1e-9;
    const n = Math.max(1, Math.round(P.strokes) - (nearer ? Math.round(P.fewer) : 0));
    const start = 0.05 + (nearer ? P.late : 0);
    // the turning points: where it starts, a zigzag, the start of the slide, and beside the other
    const slide = n > 1 ? P.slide : 0;
    const wx = [x0],
      wy = [y0];
    const lx = x1 + sign * slide * sn,
      ly = y1 - sign * slide * cs;
    for (let k = 1; k < n - 1; k++) {
      const f = k / (n - 1),
        lean = (k % 2 ? 1 : -1) * P.weave;
      wx.push(mix(x0, lx, f) - (ly - y0) * lean);
      wy.push(mix(y0, ly, f) + (lx - x0) * lean);
    }
    if (n > 1) {
      wx.push(lx);
      wy.push(ly);
    }
    wx.push(x1);
    wy.push(y1);
    const x = clamp((u - start) / (P.contactAt - start)) * n;
    const k = Math.min(n - 1, Math.floor(x)),
      f = x - k;
    const gather = f < 0.2 ? Math.sin((f / 0.2) * Math.PI) : 0;
    const t = clamp((f - 0.2) / 0.55);
    const lunge = t > 0 && t < 1 ? (1 - t) ** 2 * smooth(0, 0.1, t) : 0;
    const way = (i: number) => (i < 0 ? from + Math.PI / 2 + about : Math.atan2(wy[Math.min(i, n - 1) + 1] - wy[Math.min(i, n - 1)], wx[Math.min(i, n - 1) + 1] - wx[Math.min(i, n - 1)]));
    const turn = (a: number, b: number, w: number) => a + wrap(b - a) * w;
    // it comes round to each new heading in the pause before the run, and is straight for the run
    const heading = f < 0.2 ? turn(way(k - 1), way(k), k ? smooth(-0.25, 0.2, f) : smooth(0, 0.2, f)) : f > 0.75 && k < n - 1 ? turn(way(k), way(k + 1), smooth(0.75, 1.2, f)) : way(k);
    const go = 1 - (1 - t) ** 3,
      dx = wx[k + 1] - wx[k],
      dy = wy[k + 1] - wy[k];
    // backing up a little as it gathers
    const back = go - P.backUp * gather;
    return [(wx[k] + dx * back) * S, (wy[k] + dy * back) * S, heading, lunge, gather, x];
  }

  // the membrane swims, and settles into the fluid of whatever holds it
  swim(b: Body) {
    const { n, x, y, px, py } = b.loop;
    const keep = Math.exp(-this.h / P.dragMembrane);
    for (let i = 0; i < n; i++) {
      const vx = (x[i] - px[i]) * keep + b.ax,
        vy = (y[i] - py[i]) * keep + b.ay;
      px[i] = x[i];
      py[i] = y[i];
      x[i] += vx;
      y[i] += vy;
    }
  }

  // Everything a body holds goes where its fluid went this step: its contents, and the cells inside
  // it with all of theirs. At this size water is all drag and no momentum.
  carryAll(b: Body) {
    const L = b.loop;
    carry(L, b.org.x, b.org.y, b.org.px, b.org.py, b.org.n);
    carry(L, b.dust.x, b.dust.y, b.dust.px, b.dust.py, b.dust.n);
    for (const d of b.lodgers) carry(L, d.loop.x, d.loop.y, d.loop.px, d.loop.py, BN);
    const down = (k: Body) => {
      for (const d of k.lodgers) carry(L, d.loop.x, d.loop.y, d.loop.px, d.loop.py, BN);
      carry(L, k.loop.x, k.loop.y, k.loop.px, k.loop.py, k.loop.n);
      carry(L, k.org.x, k.org.y, k.org.px, k.org.py, k.org.n);
      carry(L, k.dust.x, k.dust.y, k.dust.px, k.dust.py, k.dust.n);
      for (const kk of k.kids) down(kk);
    };
    for (const k of b.kids) down(k);
  }

  // how far round its contents have drifted since they were given their places: cos and sin
  swirlAt(b: Body) {
    const phi = P.swirl * (this.step - b.since) * this.h * (b.side === 1 ? -1 : 1);
    return [Math.cos(phi), Math.sin(phi)];
  }

  // What its contents do of their own accord. Each has a place in the cell, as if strung in a
  // skeleton, which drifts slowly round; pushed aside, it comes back. That is what makes every
  // generation play out alike: left free, forty things jostling in a bag never do the same twice.
  stir(b: Body) {
    const { h, step, TS } = this;
    const L = b.loop,
      S = b.S;
    const c = Math.cos(L.ang),
      s = Math.sin(L.ang);
    const big = b.side === 2 ? Math.SQRT2 : 1;
    const ex = big * b.sp.AX,
      ey = big * b.sp.BX;
    const [tc, ts] = this.swirlAt(b);
    const keep = Math.exp(-h / P.dragContents);
    const phase = (step % TS) / TS;
    // Places keep clear of the cells inside, and of the space between two that are closing: what
    // gets caught between them goes one way or the other on a hair, and never the same way twice.
    const room = this.rooms;
    let rooms = 0;
    for (const kid of b.kids) {
      room[rooms * 3] = kid.loop.cx;
      room[rooms * 3 + 1] = kid.loop.cy;
      room[rooms++ * 3 + 2] = P.berth * (kid.side === 2 ? Math.SQRT2 : 1) * kid.sp.AX * kid.S;
    }
    if (b.kids.length === 2) {
      // where the two will meet
      const [k1] = b.kids;
      const u = step / TS - Math.floor(step / TS);
      const [ox, oy] = this.offset(k1.g);
      room[rooms * 3] = L.cx + ox * k1.S;
      room[rooms * 3 + 1] = L.cy + oy * k1.S;
      room[rooms++ * 3 + 2] = P.berth * P.clearing * k1.S * smooth(P.clearFrom, P.contactAt - 0.02, u);
    }
    this.roomCount = rooms;
    // and of the lodgers, which stay put while everything small drifts round: a place that drifted
    // straight through one would leave its owner to go round it either way
    for (const lod of b.lodgers) {
      room[rooms * 3] = lod.loop.cx;
      room[rooms * 3 + 1] = lod.loop.cy;
      room[rooms++ * 3 + 2] = lod.reach * lod.S * 1.08;
    }
    const shake = P.brown * S * h * Math.sqrt(h);
    for (const [set, dusty] of [
      [b.org, false],
      [b.dust, true],
    ] as const) {
      const { n, x, y, px, py, seed, hx, hy } = set;
      const home = 1 - Math.exp(-h / (dusty ? P.dustHome : P.homeTime));
      for (let i = 0; i < n; i++) {
        const nx = hx[i] / ex,
          ny = hy[i] / ey;
        let lx = ex * (nx * tc - ny * ts),
          ly = ey * (nx * ts + ny * tc);
        if (!dusty) {
          const m = 2 + Math.floor(seed[i] * 5);
          lx += P.wander * Math.sin(TAU * (m * phase + seed[i] * 7));
          ly += P.wander * Math.cos(TAU * ((m + 1) * phase + seed[i] * 13));
        }
        let gx = L.cx + S * (c * lx - s * ly),
          gy = L.cy + S * (s * lx + c * ly);
        if (!dusty) {
          // every push is worked out from where the place was, and they are added: pushed out of
          // one thing and then the next, a place between two would jump as they moved
          let ax = 0,
            ay = 0;
          for (let k = 0; k < rooms; k++) {
            const dx = gx - room[k * 3],
              dy = gy - room[k * 3 + 1];
            const d = hyp(dx, dy),
              keepOff = room[k * 3 + 2] + set.r[i] * S;
            if (d < keepOff && d > 0) {
              ax += (dx / d) * (keepOff - d);
              ay += (dy / d) * (keepOff - d);
            }
          }
          gx += ax;
          gy += ay;
        }
        let ux = (x[i] - px[i]) * keep + (gx - x[i]) * home,
          uy = (y[i] - py[i]) * keep + (gy - y[i]) * home;
        if (dusty) {
          const key = (i * 2 + b.side) * 7919 + (step % TS) * 104729;
          ux += shake * (hash(key) - 0.5);
          uy += shake * (hash(key + 1) - 0.5);
        }
        px[i] = x[i];
        py[i] = y[i];
        x[i] += ux;
        y[i] += uy;
      }
    }
  }

  tighten(b: Body, forward: boolean) {
    const S = b.S;
    let len = b.sp.edge1 * S,
      ks = Number.isNaN(b.aim) ? P.shape : P.shapeSwim,
      squash = P.edge,
      want = Math.PI * S * S,
      kb = P.bend;
    if (b.side === 2) {
      // fused: the slack is taken up, and until it is the membrane doesn't mind being short
      const sec = (this.step - b.fused) * this.h;
      const t = clamp(sec / P.tensionTime);
      len = S * mix(b.sp.edge1, b.sp.edge2, 1 - (1 - t) ** 2);
      ks = P.shapeMerged * smooth(0, P.shapeTime, sec);
      squash = P.edge * mix(P.slack, 1, smooth(P.tensionTime, P.tensionTime * 2, sec));
      want *= 2;
      // the pore opens at full snap; after that the pair takes its time becoming one shape
      if (b.fused >= 0) kb *= mix(1, P.lazy, smooth(0.25, 0.6, sec) * (1 - smooth(P.shapeTime, P.shapeTime * 1.6, sec)));
    }
    this.solve(b.loop, S, len, want, ks, squash, kb, b.turnTo, b.pulse, forward, b.wave, b.waveAt);
  }

  // One pass over a membrane: its length, its smoothness, what it holds, its shape
  solve(L: Loop, S: number, len: number, want: number, ks: number, squash: number, kb: number, turnTo: number, stretch: number, forward: boolean, wave = 0, waveAt = 0) {
    const { n, x, y, qx, qy } = L;
    for (let ii = 0; ii < n; ii++) {
      const i = forward ? ii : n - 1 - ii,
        j = i + 1 === n ? 0 : i + 1;
      const dx = x[j] - x[i],
        dy = y[j] - y[i];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d === 0) continue;
      const c = ((d > len ? P.edge : squash) * 0.5 * (d - len)) / d;
      x[i] += dx * c;
      y[i] += dy * c;
      x[j] -= dx * c;
      y[j] -= dy * c;
    }
    // smooth, with the curve of a circle of this length
    const sag = (len * Math.PI) / n;
    for (let ii = 0; ii < n; ii++) {
      const i = forward ? ii : n - 1 - ii;
      const a = i === 0 ? n - 1 : i - 1,
        c = i + 1 === n ? 0 : i + 1;
      const tx = x[c] - x[a],
        ty = y[c] - y[a];
      const tl = Math.sqrt(tx * tx + ty * ty);
      const lift = tl > 1e-6 * len ? sag / tl : 0;
      const dx = (x[a] + x[c]) / 2 + ty * lift - x[i],
        dy = (y[a] + y[c]) / 2 - tx * lift - y[i];
      x[i] += (dx * kb * 2) / 3;
      y[i] += (dy * kb * 2) / 3;
      x[a] -= (dx * kb) / 3;
      y[a] -= (dy * kb) / 3;
      x[c] -= (dx * kb) / 3;
      y[c] -= (dy * kb) / 3;
    }
    // contents
    const g = this.scratch;
    let A = 0,
      sum = 0;
    for (let i = 0; i < n; i++) {
      const a = i === 0 ? n - 1 : i - 1,
        c = i + 1 === n ? 0 : i + 1;
      A += x[i] * y[c] - x[c] * y[i];
      g[2 * i] = 0.5 * (y[c] - y[a]);
      g[2 * i + 1] = 0.5 * (x[a] - x[c]);
      sum += g[2 * i] ** 2 + g[2 * i + 1] ** 2;
    }
    if (sum > 0) {
      const lam = (-P.area * (A / 2 - want)) / sum;
      for (let i = 0; i < n; i++) {
        x[i] += lam * g[2 * i];
        y[i] += lam * g[2 * i + 1];
      }
    }
    // shape
    let cx = 0,
      cy = 0;
    for (let i = 0; i < n; i++) {
      cx += x[i];
      cy += y[i];
    }
    cx /= n;
    cy /= n;
    let p = 0,
      q = 0;
    for (let i = 0; i < n; i++) {
      const rx = x[i] - cx,
        ry = y[i] - cy;
      p += qx[i] * rx + qy[i] * ry;
      q += qx[i] * ry - qy[i] * rx;
    }
    let th = Math.atan2(q, p);
    if (!Number.isNaN(turnTo)) th += clamp(wrap(turnTo - th), -0.6, 0.6) * P.steer;
    if (ks > 0) {
      const c = Math.cos(th),
        s = Math.sin(th);
      for (let i = 0; i < n; i++) {
        // a waist that starts at the nose and runs to the tail
        const waist = wave ? 1 - wave * Math.exp(-(((qx[i] - 1.3 + 2.6 * waveAt) / 0.45) ** 2)) : 1;
        const lx = qx[i] * stretch,
          ly = (qy[i] / stretch) * waist;
        x[i] += ks * (cx + S * (c * lx - s * ly) - x[i]);
        y[i] += ks * (cy + S * (s * lx + c * ly) - y[i]);
      }
    }
  }

  // A membrane is a fluid in its own plane: its points slide along it until they are evenly spread.
  // Sliding is not motion, so where they were slides with them.
  spread(L: Loop) {
    const { n, x, y, px, py } = L;
    const g = this.scratch;
    let total = 0,
      mean = 0;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      g[i] = total;
      total += hyp(x[j] - x[i], y[j] - y[i]);
    }
    const each = total / n;
    for (let i = 0; i < n; i++) mean += g[i] - i * each;
    mean /= n;
    // by how much each should slide, forwards along the curve
    for (let i = 0; i < n; i++) g[i] = P.flow * (mean + i * each - g[i]);
    const x0 = x[0],
      y0 = y[0];
    let bx = x[n - 1],
      by = y[n - 1];
    for (let i = 0; i < n; i++) {
      const ax = i + 1 === n ? x0 : x[i + 1],
        ay = i + 1 === n ? y0 : y[i + 1];
      const cx = x[i],
        cy = y[i];
      const s = g[i];
      // towards the next point, or back towards the last, never more than part of the way
      const tx = s >= 0 ? ax - cx : bx - cx,
        ty = s >= 0 ? ay - cy : by - cy;
      const tl = hyp(tx, ty);
      if (tl > 0) {
        const f = Math.min(Math.abs(s) / tl, 0.4);
        x[i] += tx * f;
        y[i] += ty * f;
        px[i] += tx * f;
        py[i] += ty * f;
      }
      bx = cx;
      by = cy;
    }
  }

  // a generation's membranes against each other, against what holds them, and against what floats
  // beside them in it
  walls(G: Gen, last: boolean) {
    const a = this.age(G);
    if (!G.merged && a >= -1) {
      // two cells with their hairs between them
      const [A, B] = G.bodies;
      const gap = mix(P.gapFar, P.gapNear, smooth(P.contactAt - 0.1, 0.98, a + 1)) * A.S;
      const reach = gap + 2.5 * A.sp.edge1 * A.S;
      // Their middles are never closer than they could be lying side by side: if they are, they are
      // moved apart bodily. Membrane against membrane only keeps the two walls off each other.
      const dx = B.loop.cx - A.loop.cx,
        dy = B.loop.cy - A.loop.cy;
      const d = hyp(dx, dy),
        least = 1.75 * A.sp.BX * A.S;
      if (d < least && d > 0) {
        const sx = ((dx / d) * (least - d)) / 2,
          sy = ((dy / d) * (least - d)) / 2;
        for (let i = 0; i < N; i++) {
          A.loop.x[i] -= sx;
          A.loop.y[i] -= sy;
          B.loop.x[i] += sx;
          B.loop.y[i] += sy;
        }
      }
      for (let i = 0; i < N; i++) hold(B.loop, A.loop.x, A.loop.y, i, gap, reach, 0.5, true, -1, true);
      for (let i = 0; i < N; i++) hold(A.loop, B.loop.x, B.loop.y, i, gap, reach, 0.5, true, -1, true);
    }
    for (const b of G.bodies) {
      const L = b.loop,
        S = b.S;
      const near = 2.5 * b.sp.edge1 * S;
      if (b.fused >= 0 && (this.step - b.fused) * this.h < P.seamTime) {
        // freshly fused: the two walls of what is left of the seam can't pass through each other
        const gap = 0.6 * b.sp.edge1 * S;
        for (let i = 0; i < L.n; i++) hold(L, L.x, L.y, i, gap, gap + near, 0.5, true, i);
      }
      const p = b.parent;
      if (!p) continue;
      const pl = p.loop;
      const far = (b.side === 2 ? Math.SQRT2 : 1) * b.sp.AX * S;
      // nowhere near the wall: none of its points can be
      const m = 0.03 * S,
        slack = 2.5 * p.sp.edge1 * p.S;
      if (pl.nearest(L.cx, L.cy, far * 1.5 + m + slack)) for (let i = 0; i < L.n; i++) hold(pl, L.x, L.y, i, m, m + slack, 0.75, false);
      const o = p.org,
        d = p.dust;
      for (let i = 0; i < o.n; i++) {
        const r = o.r[i] * p.S;
        if (Math.abs(o.x[i] - L.cx) > far * 1.6 + r || Math.abs(o.y[i] - L.cy) > far * 1.6 + r) continue;
        hold(L, o.x, o.y, i, r, r + near, 0.92, true);
      }
      if (last)
        for (let i = 0; i < d.n; i++) {
          if (Math.abs(d.x[i] - L.cx) > far * 1.6 || Math.abs(d.y[i] - L.cy) > far * 1.6) continue;
          hold(L, d.x, d.y, i, 0.01 * p.S, 0.01 * p.S + near, 1, true);
        }
      // and the lodgers it has to shoulder through: both give
      const gap = P.lodgerGap * S;
      for (const lod of p.lodgers) {
        const dl = lod.loop,
          big = lod.reach * lod.S + gap;
        if (hyp(dl.cx - L.cx, dl.cy - L.cy) > far * 1.2 + big) continue;
        stay(L, lod, 0.6 * lod.S + gap, far * 1.3 + big, true);
        const close = big + near,
          nearL = 2.5 * lod.edge * lod.S;
        for (let i = 0; i < L.n; i++) {
          if (Math.abs(L.x[i] - dl.cx) > close || Math.abs(L.y[i] - dl.cy) > close) continue;
          hold(dl, L.x, L.y, i, gap, gap + nearL, P.yield, true, -1, true);
        }
        for (let i = 0; i < BN; i++) hold(L, dl.x, dl.y, i, gap, gap + near, 1 - P.yield, true);
      }
    }
  }

  // What a body's lodgers do of their own accord: drift back to their places, out of the way of two
  // cells that are closing.
  drift(b: Body) {
    if (!b.lodgers.length) return;
    const { h } = this;
    const L = b.loop,
      S = b.S;
    const c = Math.cos(L.ang),
      s = Math.sin(L.ang);
    const keep = Math.exp(-h / P.dragContents),
      home = 1 - Math.exp(-h / P.lodgerHome);
    // Their places keep out of the way of two cells that are closing, late enough that the cells have
    // had to push past them first; and of the one cell those two become, for good.
    const room = this.rooms,
      gapAt = b.kids.length === 2 ? (this.roomCount - 1) * 3 : b.kids.length === 1 && b.kids[0].side === 2 ? 0 : -1;
    for (const lod of b.lodgers) {
      const { x, y, px, py } = lod.loop;
      let mx = 0,
        my = 0;
      for (let i = 0; i < BN; i++) {
        mx += x[i] / BN;
        my += y[i] / BN;
      }
      let gx = L.cx + S * (c * lod.hx - s * lod.hy),
        gy = L.cy + S * (s * lod.hx + c * lod.hy);
      if (gapAt >= 0) {
        const dx = gx - room[gapAt],
          dy = gy - room[gapAt + 1];
        const d = hyp(dx, dy),
          keepOff = room[gapAt + 2] + lod.reach * lod.S;
        if (d < keepOff && d > 0) {
          gx += (dx / d) * (keepOff - d);
          gy += (dy / d) * (keepOff - d);
        }
      }
      const sx = (gx - mx) * home,
        sy = (gy - my) * home;
      for (let i = 0; i < BN; i++) {
        const vx = (x[i] - px[i]) * keep + sx,
          vy = (y[i] - py[i]) * keep + sy;
        px[i] = x[i];
        py[i] = y[i];
        x[i] += vx;
        y[i] += vy;
      }
    }
  }

  // lodgers against their cell's wall, each other, and the small things round them
  crowd(b: Body, forward: boolean) {
    const L = b.loop,
      S = b.S;
    const slack = 2.5 * b.sp.edge1 * S,
      m = 0.02 * S;
    const all = b.lodgers;
    for (const lod of all) {
      const dl = lod.loop;
      this.firm(lod, forward);
      dl.measure();
      if (dl.area() < 0.45 * lod.room * lod.S * lod.S) {
        // crushed past recovering, or turned inside out: it is put back as it was made, where it is
        const c = Math.cos(dl.ang),
          sn = Math.sin(dl.ang);
        for (let i = 0; i < BN; i++) {
          dl.x[i] = dl.px[i] = dl.cx + lod.S * (c * dl.qx[i] - sn * dl.qy[i]);
          dl.y[i] = dl.py[i] = dl.cy + lod.S * (sn * dl.qx[i] + c * dl.qy[i]);
        }
        this.healed++;
      }
      dl.grid(3 * lod.edge * lod.S);
    }
    for (const lod of all) {
      const dl = lod.loop;
      if (!L.nearest(dl.cx, dl.cy, lod.reach * lod.S * 1.3 + m + slack)) continue;
      stay(L, lod, 0.6 * lod.S, lod.reach * lod.S * 1.3 + m + slack, false);
      for (let i = 0; i < BN; i++) hold(L, dl.x, dl.y, i, m, m + slack, 0.92, false);
    }
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const A = all[i],
          B = all[j];
        const dx = B.loop.cx - A.loop.cx,
          dy = B.loop.cy - A.loop.cy;
        const d = hyp(dx, dy);
        if (d > (A.reach * A.S + B.reach * B.S) * 1.15 + m) continue;
        // middles never closer than this, whatever their outlines are doing
        const least = 0.62 * (A.S + B.S);
        if (d < least && d > 0) {
          const sx = ((dx / d) * (least - d)) / 2,
            sy = ((dy / d) * (least - d)) / 2;
          for (let v = 0; v < BN; v++) {
            A.loop.x[v] -= sx;
            A.loop.y[v] -= sy;
            B.loop.x[v] += sx;
            B.loop.y[v] += sy;
          }
          A.loop.cx -= sx;
          A.loop.cy -= sy;
          B.loop.cx += sx;
          B.loop.cy += sy;
        }
        for (let v = 0; v < BN; v++) hold(B.loop, A.loop.x, A.loop.y, v, m, m + 2.5 * B.edge * B.S, 0.5, true, -1, true);
        for (let v = 0; v < BN; v++) hold(A.loop, B.loop.x, B.loop.y, v, m, m + 2.5 * A.edge * A.S, 0.5, true, -1, true);
      }
    // The small things are not pushed out of lodgers: their places already steer round them, and a
    // hard push decides left or right on a hair. One caught passing is simply seen through the lodger,
    // as things at different depths under a microscope are.
    // Its own shape and what it holds have the last word: squeezed into too small a space it pushes
    // back into what is squeezing it, which then has to give, rather than be pressed flat.
    for (const lod of all) this.firm(lod, !forward);
  }

  // a lodger holding itself together: the more it has been squeezed, the harder
  firm(lod: Lodger, forward: boolean) {
    const full = lod.room * lod.S * lod.S;
    const squeezed = clamp(1 - lod.loop.area() / full - 0.12, 0, 0.6);
    this.solve(lod.loop, lod.S, lod.edge * lod.S, full, P.lodgerShape * (1 + 14 * squeezed), P.edge, P.bend, NaN, 1, forward);
  }

  // a body's contents against each other and its wall
  jostle(b: Body, last: boolean) {
    const L = b.loop,
      S = b.S;
    const slack = 2.5 * b.sp.edge1 * S;
    const o = b.org;
    for (let i = 0; i < o.n; i++) {
      // Drops and grains jostle nothing, not each other and not the bigger things, which pass over
      // them as things at another depth do: dozens of specks knocked about by whatever a swimmer
      // has just shoved aside is what never plays out the same twice.
      if (o.kind[i] >= DROP) continue;
      const ri = o.r[i] * S;
      for (let j = i + 1; j < o.n; j++) {
        if (o.kind[j] >= DROP) continue;
        const dx = o.x[j] - o.x[i],
          dy = o.y[j] - o.y[i];
        const rr = ri + o.r[j] * S;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 === 0) continue;
        const d = Math.sqrt(d2);
        // the lighter one gives way
        const wi = o.r[j] * o.r[j],
          wj = o.r[i] * o.r[i];
        const c = (rr - d) / d / (wi + wj);
        o.x[i] -= dx * c * wi;
        o.y[i] -= dy * c * wi;
        o.x[j] += dx * c * wj;
        o.y[j] += dy * c * wj;
      }
    }
    for (let i = 0; i < o.n; i++) hold(L, o.x, o.y, i, o.r[i] * S, o.r[i] * S + slack, 0.93, false);
    const d = b.dust;
    if (last) for (let i = 0; i < d.n; i++) hold(L, d.x, d.y, i, 0.012 * S, 0.012 * S + slack, 1, false);
  }

  // Hairs: each tip chases a beating target and trails behind a root that moves through the water.
  // The beat is a wave running tailwards along the body.
  hairs(b: Body) {
    const L = b.loop,
      S = b.S;
    const { n, x, y, px, py, cox, coy, crn } = L;
    const hc = Math.cos(L.ang),
      hs = Math.sin(L.ang);
    const kc = 1 - Math.exp((-2 * this.h) / P.hairLag);
    const sway = b.sp.hairSwing;
    const beat = (TAU * ((this.beats * this.step) % this.TS)) / this.TS;
    // the outward normal at point 0, then carried round
    let tx = x[1] - x[n - 1],
      ty = y[1] - y[n - 1],
      tl = hyp(tx, ty) || 1;
    let n0x = ty / tl,
      n0y = -tx / tl;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1,
        k2 = j + 1 === n ? 0 : j + 1;
      tx = x[k2] - x[i];
      ty = y[k2] - y[i];
      tl = hyp(tx, ty) || 1;
      const n1x = ty / tl,
        n1y = -tx / tl;
      for (let k = 0; k < CIL; k++) {
        const c = i * CIL + k;
        const f = crn[c * 3];
        if (crn[c * 3 + 1] === 0) continue;
        const bx = x[i] + (x[j] - x[i]) * f,
          by = y[i] + (y[j] - y[i]) * f;
        let nx = n0x + (n1x - n0x) * f,
          ny = n0y + (n1y - n0y) * f;
        const nl = hyp(nx, ny) || 1;
        nx /= nl;
        ny /= nl;
        const tailward = nx * hs - ny * hc; // minus (tangent . heading)
        const along = ((bx - L.cx) * hc + (by - L.cy) * hs) / S;
        const ph = beat + P.hairWaves * along + crn[c * 3 + 2];
        const s1 = Math.sin(ph),
          c1 = Math.cos(ph);
        // the stroke is quick one way and slow back; a little sway of its own on top
        const swing = (s1 + 0.6 * s1 * c1) * sway;
        const own = P.hairStray * Math.sin(crn[c * 3 + 2] * 5.3);
        const beta = tailward * (P.hairTilt + P.hairSweep * b.thrust + P.hairSwing * swing * (1 - 0.6 * b.thrust)) + 0.25 * P.hairSwing * c1 * sway + own;
        const len = b.sp.hair * S * crn[c * 3 + 1];
        const lean = beta > 1.15 ? 1.15 : beta < -1.15 ? -1.15 : beta; // never flat against the wall, or into it
        const cb = Math.cos(lean),
          sb = Math.sin(lean);
        const gx = len * (nx * cb - ny * sb),
          gy = len * (ny * cb + nx * sb);
        let ox = cox[c],
          oy = coy[c];
        if (ox === 0 && oy === 0) {
          ox = gx;
          oy = gy;
        } else {
          // the tip stays where it was in the water, then is drawn to where it should be
          ox -= 2 * (bx - (px[i] + (px[j] - px[i]) * f));
          oy -= 2 * (by - (py[i] + (py[j] - py[i]) * f));
          ox += (gx - ox) * kc;
          oy += (gy - oy) * kc;
        }
        const ol = hyp(ox, oy) || 1;
        cox[c] = (ox / ol) * len;
        coy[c] = (oy / ol) * len;
      }
      n0x = n1x;
      n0y = n1y;
    }
  }

  // One step, outermost generation first. Each is solved within what holds it, already moved; then
  // all it holds is moved with it, before that in turn is solved. So nothing ever lags behind its
  // container, however small it is beside it.
  tick() {
    for (const G of this.gens) {
      const bodies = G.bodies;
      for (const b of bodies) b.loop.measure();
      this.control(G);
      for (const b of bodies) this.swim(b);
      for (let it = 0; it < P.iters; it++) {
        const forward = (this.step + it) % 2 === 0;
        for (const b of bodies) this.tighten(b, forward);
        if (it === 0) for (const b of bodies) b.loop.grid(3 * b.sp.edge1 * b.S);
        this.walls(G, it === P.iters - 1 && this.step % 3 === 1);
      }
      for (const b of bodies) {
        this.spread(b.loop);
        // hairs are moved every other step, and dust is kept in every third: neither needs more
        if (this.step % 2 === 0 && this.age(G) >= HAIRY) this.hairs(b);
        b.loop.measure();
        this.carryAll(b);
        b.loop.grid(3 * b.sp.edge1 * b.S);
        this.stir(b);
        this.drift(b);
        for (let it = 0; it < P.iters; it++) {
          // lodgers of cells still small and at rest inside another need only one pass
          if (b.lodgers.length && (it === 0 || this.age(G) >= -1)) this.crowd(b, (this.step + it) % 2 === 0);
          this.jostle(b, it === P.iters - 1 && this.step % 3 === 0);
        }
      }
    }
    this.step++;
    this.events();
  }

  // How deep the view is, in generations, at a time in periods: a whole number is a fusion seen at
  // full size. Either a steady dive, or one made in bursts: it holds on a fusion and what follows,
  // then rushes down to where the next one is about to happen.
  depth(t: number) {
    const k = Math.floor(t),
      u = t - k;
    if (!P.zoomFast) return k + u - (P.zoomPulse * Math.sin(TAU * u)) / TAU;
    const x = this.burst(u);
    return k + P.zoomCreep * u + (1 - P.zoomCreep) * x * x * x * (x * (6 * x - 15) + 10);
  }
  // how far through a burst, 0..1
  burst(u: number) {
    const w = clamp(P.zoomTakes, 0.02, 1),
      at = clamp(P.zoomAt, w / 2, 1 - w / 2);
    return clamp((u - at) / w + 0.5);
  }
  // how many times faster than the clock the cells live just now: more, in the thick of a burst
  pace(step = this.step) {
    if (!P.zoomFast || P.rush <= 1) return 1;
    const x = this.burst((step % this.TS) / this.TS);
    return 1 + (P.rush - 1) * 16 * x * x * (1 - x) * (1 - x);
  }

  // seconds of the clock that one loop takes
  seconds() {
    let s = 0;
    for (let k = 0; k < this.TS; k++) s += this.h / this.pace(k);
    return s * this.kinds.length;
  }

  // Where a generation's two meet, or have met: the middle of the fused cell, and before that the
  // place in the cell holding them that they are making for.
  meet(G: Gen): number[] {
    let mx = 0,
      my = 0;
    for (const b of G.bodies) {
      const L = b.loop;
      let sx = 0,
        sy = 0;
      for (let i = 0; i < L.n; i++) {
        sx += L.x[i];
        sy += L.y[i];
      }
      mx += sx / L.n / G.bodies.length;
      my += sy / L.n / G.bodies.length;
    }
    const held = this.gen(G.g - 1);
    if (G.merged || !held) return [mx, my];
    const [px, py] = this.meet(held);
    const [ox, oy] = this.offset(G.g);
    const S = G.bodies[0].S;
    // once they touch, it is wherever they in fact are
    const there = smooth(P.contactAt, 1, this.age(G) + 1);
    return [mix(px + ox * S, mx, there), mix(py + oy * S, my, there)];
  }

  // The view: on whichever pair is about to fuse, and already leaning towards where the next will,
  // diving K times per period and turning with them. `depth` says how far down it is.
  camera() {
    const t = this.step / this.TS;
    const depth = this.depth(t);
    let x = 0,
      y = 0,
      total = 0;
    for (const G of this.gens) {
      const a = depth - G.g + P.lead;
      const w = a <= -1 || a >= 1 ? 0 : a < 0 ? smooth(-1, 0, a) : 1 - smooth(0, 1, a);
      if (w === 0) continue;
      const [mx, my] = this.meet(G);
      x += w * mx;
      y += w * my;
      total += w;
    }
    const G = this.gens[0];
    return {
      x: x / total,
      y: y / total,
      zoom: (P.frame * K ** (depth - G.g)) / G.bodies[0].S,
      turn: this.theta * (P.zoomFast ? mix(t, depth, P.zoomTwist) : t) - (P.axis * Math.PI) / 180,
      depth,
    };
  }
}
