// The crowd: colonies standing still on a floor, filling one side of a line through the middle of the
// view. The camera closes in on a point of that line for ever. Each period every colony in view bursts,
// once, and its daughters come down as the same crowd over again at a smaller size: each has a place
// waiting for it, is thrown towards it, drawn gently the rest of the way, and set down in it exactly.
//
// The places are one arrangement P, worked out once. A colony of this generation with number i stands
// at P[i]; the daughters of them all stand at P again, shrunk about the middle of the view by `s`. With
// K daughters each and s = 1 / sqrt(K), they cover the ground their mothers did. What the camera has at
// the end of a period is the inner part of the shrunk P, which is the inner part of P a period before,
// smaller: the same picture. Then everything is made 1/s bigger and it starts again.
import { ball, type Ball, Body, H, invert, match, press, rng, smooth } from "../volvox/soft.ts";

// Shapes for the crowd: which way it is turned, how far round the middle it reaches, how many colonies
// (as many as make it reach equally far), and which random crowd (one of forty tried that leaves each
// colony's daughters' places nearest it: in some, many lie two or three colonies off, and it shows).
export const SHAPES: Record<string, [number, number, number, number]> = {
  "a half, on the diagonal": [24, 0.5, 72, 57],
  "a mound from below": [180, 0.36, 52, 26],
  "a point from below": [180, 0.25, 36, 15],
  "all round a bay": [0, 0.68, 98, 27],
  "all round a notch": [0, 0.75, 104, 29],
  "a half, another draw": [24, 0.5, 72, 26],
};

export const C = {
  period: 8, // seconds a generation
  kids: 6, // daughters in every colony: the camera closes in sqrt(kids) times a period. Six is the fewest that fit inside their mother at the size they will stand at
  mothers: 72, // colonies in the crowd when a period starts
  edge: 24, // degrees the crowd is turned: at 0 it lies up the view from the middle, at 180 down it
  around: 0.5, // how much of the way round the middle the crowd reaches. Half: one side of a line through the middle. Less: a wedge of colonies with its point at the middle. More: colonies all round but for a wedge of empty floor
  panAcross: 3, // the view looks this far to the right of the point it closes in on, and this far up the view, in a colony's radii as a period starts: so that more of it is crowd
  panUp: 0.75,
  seed: 57, // which random crowd. Some come out with every colony's daughters' places near it, some with many far off: worth trying a few
  ragged: 0.7, // how uneven that edge is, in radii
  packed: 0.72, // how much of the ground they cover
  gravity: 14,
  sink: 6.5,
  soft: 0.03,
  taut: 1.4, // a daughter just let out is this much stiffer again
  give: 0.55,
  ripple: 0.35,
  friction: 0.6,
  bands: 3, // the bursting goes round the crowd as this many bands at once, each from one side of it to the other in a period
  stray: 0.05, // each colony bursts this much of a period sooner or later than the band would have it
  seen: 1, // and only while it is still this far inside the view, of the view's reach
  pop: 0.9, // when the skin gives, the daughters are pushed out from the middle this fast, in their mother's radii a second: and that is all
  lean: 0.5, // and all together this much of the way towards the middle of where they will stand
  teach: 0.7, // each generation is a rehearsal for the next. A litter is let out with the best pushes found so far and this much of how far short each daughter then was; kept if they all came nearer, tried again with half as much if not
  teachFor: 4, // rehearsals: after that the best of them is what happens, for good
  pushMost: 1.5, // the most such a push can be, in the mother's radii a second (a place under something standing cannot be rolled to however hard)
  fallFor: 1.3, // seconds they are left to fall and roll off each other, before any is given a place
  grip: 0.3, // on the floor it turns just as far as it goes: how firmly it is held to that, a step
  homeIn: 0.7, // seconds over which the pull to its place then comes on
  pull: 10, // how hard: a spring, so it comes in a little fast, runs on past, and settles
  calm: 3, // and how much its sliding about is damped as it does
  learn: 5, // generations over which each place takes the way up its daughter comes to it as the way up to stand (once the pushes are settled); then that is kept, so that the crowd comes round exactly the same
  sleepAt: 2.5, // seconds after which, when it has all but stopped, the last of the difference from how it will stand is taken out, and it is left
  easeFor: 0.9, // over this long, seconds
  // alive while standing
  turns: 0, // a standing colony turns about its upright this many times a period, one way or the other (some twice as many). None: it looked wrong
  flinch: 0.16, // when one bursts, the ones standing round it rock away by this much of its radius, and back
  flinchRate: 7.5, // how fast they rock
  flinchFade: 2.6, // and how soon that dies down
  blast: 1, // and whatever is still moving near it is pushed away, at most this many of its own radii a second (spread over `blastFor`, so it is a push and not a jolt)
  blastFloor: 0.35, // as much of that for one already rolling on the floor, and not lifted
  blastFor: 0.3, // seconds the push is spread over
  bob: 0.03, // a colony's daughters shift about inside it, by this much of its radius
  eager: 1.6, // and that many times more again in the last moments before it bursts
  eagerFor: 0.7, // seconds before it bursts that this begins (coming on gradually)
  eagerPace: 0.6, // and how quick that shaking is, against about 2.5 times a second at 1
  matureFrom: 0.04, // of a period after it is let out, its cells start to draw apart
  matureBy: 0.3,
  dent: 0.32,
  fuse: 0.16,
  tear: 0.34,
  // An experiment (?free): nothing is pulled to a place, and every litter touches every other. A
  // daughter rolls where she will. One whose colony will never burst takes where she comes to rest as
  // her place from then on. One whose colony will burst cannot (the view closes in 2.45 times a period:
  // she would be that much further off in her daughters, and theirs again, and the crowd comes apart),
  // so she is let out with a push learnt over rehearsals, judged by where she comes to rest; what she is
  // still off when she stops is taken out as she settles.
  free: false,
  // An experiment (?putt): no spring. A daughter is let out with a push solved beforehand so that she
  // rolls, of herself, to just where she stands; what is left over is taken out the way a ball on a
  // green comes to rest: she is slowed, or rolls a little further, and curves a little, but is never
  // turned back. Only once she has all but stopped there is the last of it eased out, as before.
  putt: false,
  roll: 2.2, // how fast rolling dies away on the floor by itself, a second (as speed over the distance it then still goes)
  brake: 3, // the most she is slowed beyond that, in her radii a second a second
  drive: 1, // the most she is helped on, likewise
  curve: 1, // the most she is turned aside, likewise
  steer: 4, // how quickly the steering answers, a second
  puttPush: 6, // the most a solved push can be, in the mother's radii a second
  crossCost: 50, // how much two daughters sent across each other's way count against a sharing, against the pushes it needs
  backMost: Infinity, // the most a solved push may go back across her mother, in the mother's radii a second
  inward: 0, // how much a push back across her mother counts against a sharing, times its square
  crossNear: 0, // and, if more than nothing, passing nearer than this many times their two radii counts as crossing
  shareFor: 6, // rounds over which which daughter goes to which place may still change: to whichever way needs the least push
  // (the solving, done beforehand by tools/cputt.ts: each time a colony bursts, a few unseen copies of
  // its litter are let out with other pushes beside the real one; they feel all the real one does, and
  // nothing feels them. Where each comes to rest says how to change the pushes: one step of Newton's
  // method a period, for `labFor` periods)
  lab: false,
  apart: true, // the unseen tries' sisters do not touch: where they bump as they come to stand side by side is not smooth enough for Newton's method, and is left to the steering
  apartFor: 0, // seconds after being let out that sisters pass through each other: still coming out of their mother
  labFor: 22,
  // (putt) Instead, sisters keep off each other softly: nearer than `sisterReach` of their two radii,
  // each is pushed away by `sisterSoft` times the square of how much nearer, in radii a second a second,
  // and their coming together damped. Nothing jumps as they touch, so the pushes can still be solved.
  sisterSoft: 0, // (tried at 400: then the pushes cannot be solved, see below)
  // (and the pushes are solved so that they need not: the tries' sisters do not touch at all, but how near
  // any two come, past `sisterReach`, counts against a try as much as being short of her place, times this)
  gapWeight: 0, // (tried at 1: it does not help)
  gapFrom: 0.15, // seconds after being let out from which that counts (before, they are still coming out of their mother, side by side)
  sisterReach: 0.95,
  sisterCalm: 6,
  sisterFor: 0, // (putt) seconds after being let out that sisters still push each other: places are packed a little closer than standing colonies are wide, so two coming to stand side by side push each other off them
  labTouch: 6, // the last rounds, in which the tries' sisters touch after all (from the pushes found without)
  labNudge: 0.15, // how much each push is changed, to see what that does, in the mother's radii a second
  mingle: false, // (free) litters in the air touch each other: more natural, but then it never comes round exactly (to about a hundredth of a radius)
  freeTeach: 12, // rehearsals of each litter's pushes before the best is kept
  freePushMost: 4, // the most such a push can be, in the mother's radii a second
  placeFor: 3, // generations, after those and after the way up is learnt (`learn`), over which a place that never bursts still moves to where its daughter came to rest, and the moment each stops is still looked for: last, when nothing else is learning
  freeLate: 2.5, // seconds past sleepAt by which one still moving is taken to stand where it is anyway
};
const PASSES = 2;
// (putt) pushes solved beforehand by tools/cputt.ts, and what crowd they are for
export const baked = { push: null as number[] | null, lands: null as number[] | null, sign: "" };
// (putt) A x = b for a small symmetric A, by elimination with pivoting
function solve(A: Float64Array, b: Float64Array, n: number) {
  const a = Float64Array.from(A),
    x = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r * n + c]) > Math.abs(a[p * n + c])) p = r;
    if (p !== c) {
      for (let k = 0; k < n; k++) [a[c * n + k], a[p * n + k]] = [a[p * n + k], a[c * n + k]];
      [x[c], x[p]] = [x[p], x[c]];
    }
    const d = a[c * n + c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = a[r * n + c] / d;
      if (!f) continue;
      for (let k = c; k < n; k++) a[r * n + k] -= f * a[c * n + k];
      x[r] -= f * x[c];
    }
  }
  for (let c = n - 1; c >= 0; c--) {
    let v = x[c];
    for (let k = c + 1; k < n; k++) v -= a[c * n + k] * x[k];
    x[c] = v / (a[c * n + c] || 1e-12);
  }
  return x;
}
export const sign = () => [C.seed, C.mothers, C.kids, C.edge, C.around, C.panAcross, C.panUp, C.ragged, C.packed, C.pop, C.lean, C.gravity, C.sink, C.period, C.bands, C.stray].join(",");
const POKE = [0.3, 0.75, 0.59]; // where on it a colony gives, from its middle

export class Cell extends Body {
  alive = false;
  asleep = false; // standing in its place: nothing about it is worked out until it bursts
  idx = 0; // its number in the arrangement
  sigma = 1; // the scale of its generation
  born = 0;
  due = -1; // the step it bursts at
  tx = 0; // its place
  tz = 0;
  inner: Float64Array; // where its daughters are: three numbers each
  innerR: Float32Array;
  there = 1;
  freeAt = -1;
  id = 0;
  litter = 0; // which burst it came of
  from = -1; // its mother's place, and which of her daughters it was
  slot = 0;
  kind = 0; // the two together: what it looks like goes by this, whatever place it comes to have
  becomes = 0; // the step its generation becomes the crowd
  placed = true; // it has been given its place
  fixed = true; // it was let out as it always will be: not as a rehearsal
  first = false;
  yaw = 0; // how far round its upright it is turned, standing
  yaw0 = 0; // as it was when it came to stand: how turned, how it lay, where its middle was from its place
  g0 = new Float64Array(9);
  c0 = [0, 0, 0];
  shown = [NaN, NaN, NaN]; // the turn and rocking its points were last set out for
  aimX = 0; // the clear ground it is being pulled to, and when that was last looked for
  aimZ = 0;
  aimAt = -99;
  ox = 0; // rocked this far from its place by something bursting near it
  oz = 0;
  lie = new Float64Array(9); // how it is turned as it stands, this moment
  lieQ = new Float64Array(4); // the same as a turn
  q0 = [0, 0, 0, 1]; // the way up it was let out
  easedAt = 0;
  easing = false; // the last of the difference from how it will stand is being taken out
  shove = [0, 0, 0]; // what is left of a push from a burst near it, to be given over the next moments
  judged = true; // (free) its litter's rehearsal has been judged
  ghost = 0; // (putt) an unseen copy, let out to see where a push takes her: which try she is, from 1
  helped = 0; // (putt) how much she has been slowed, helped on or turned, in all: her radii a second a second, summed over steps
  stirred = 0; // changes whenever anything about it moves: whoever draws it need only look again then
  constructor(mesh: Ball, x: Float32Array, p: Float32Array, kids: number) {
    super(mesh, 1, 0, x, p);
    this.inner = new Float64Array(kids * 3);
    this.innerR = new Float32Array(kids);
  }
}

const vx = new Float32Array(700),
  vy = new Float32Array(700),
  vz = new Float32Array(700);

export class Crowd {
  step = 0;
  TS = Math.round(C.period / H);
  K = Math.max(2, Math.round(C.kids));
  s = 1 / Math.sqrt(Math.max(2, Math.round(C.kids)));
  M = Math.round(C.mothers);
  N: number;
  A: number; // how far from the middle the crowd reaches when a period starts
  mesh = ball(2);
  x: Float32Array;
  p: Float32Array;
  cells: Cell[] = [];
  live: Cell[] = []; // every body there is, burst ones apart
  ghosts: Cell[] = [];
  // the arrangement: where each stands, how big, which way up, whose daughter it is, when it bursts
  px: Float64Array;
  pz: Float64Array;
  pr: Float64Array;
  turns: number[][] = [];
  spins: number[][] = []; // the same as nine numbers
  seats: Float64Array[] = []; // where each daughter sits in each mother as she stands, in the world's directions and her radii
  starts: number[][] = []; // which way up a daughter is let out, for each place: found so that her roll ends the way up she stands
  learnt = new Uint8Array(0);
  rev = new Int8Array(0); // turns a period of each place's colony as it stands
  phase = new Float64Array(0);
  jolts: { x: number; z: number; R: number; at: number }[] = []; // what has burst lately, and where
  seeds: number[] = [];
  parent: Int32Array;
  when: Float64Array;
  homes: Float64Array[] = []; // where a colony's daughters sit in it, in its radii
  kidsOf: number[][] = []; // and the places her daughters will have between them
  push = new Float32Array(0); // the push each daughter of each colony starts with next time: two numbers each, in the mother's measure
  kept = new Float32Array(0); // the best found so far, how far short each then was, and which place each took
  keptShort = new Float32Array(0);
  keptLands = new Int32Array(0);
  keptCost = new Float64Array(0); // how far short they were in all, then
  stride = new Float32Array(0); // how much of the shortfall is tried next
  tries = new Uint8Array(0); // rehearsals so far
  lands = new Int32Array(0); // which of those each daughter took last time: she is let out as for that one
  aims = new Float64Array(0); // (free) which way each litter leans: to the middle of its places as they were first laid out, in the mother's measure
  moved = new Uint8Array(0); // (free) how many times each place has been moved to where its daughter came to rest
  stopAfter = new Int32Array(0); // (free) how many steps after she was let out each place's daughter came to stand, the last time it was looked for
  bursts = new Uint8Array(0); // (free) the colony in this place will burst: its place is kept
  stops = new Float64Array(0); // (free) where each daughter of each colony came to rest last time, in the measure of a period's start
  // (putt) the solving: for each daughter of each colony, how where she stops moves with her push (two
  // by two, in the mother's measure), how far short she was with the best pushes so far, and the tries
  // of the round under way: their pushes, and how far short each daughter of each try stopped
  feel = new Float64Array(0);
  short = new Float64Array(0);
  best = new Float64Array(0);
  trial = new Float64Array(0);
  T = 0; // tries a round: the pushes so far, each push nudged one way and the other in turn, a step of Newton's method and half of one
  jac = new Float64Array(0); // each litter's: how where each daughter stops moves with each push (all twelve by twelve)
  step2 = new Float64Array(0); // and the step it says to take next
  close = new Float64Array(0); // (putt) how far into each other each two sisters of each try came, at most, in their radii
  closeBest = new Float64Array(0);
  jacC = new Float64Array(0); // and how that moves with each push
  outOf = new Float64Array(0); // where each daughter is let out from, from her mother's place, in the mother's measure
  missed2 = new Float64Array(0);
  waiting = new Int32Array(0); // daughters of the round still rolling
  rounds = new Int32Array(0);
  ghostIds = 0;
  labLog: number[][] = []; // (for looking into it: each round's colony, period, best try, its mean shortfall and the real one's)
  never = -9; // in `when`: it does not burst
  // how a colony of radius one stands, as it settles by itself: how far from its upright line and how
  // high each point of its skin is, by how high that point is on the ball
  wide = new Float64Array(33);
  high = new Float64Array(33);
  standY = 0.9; // and how high its middle is, and how much lower than wide it is
  squat = 0.9;
  widest = 1.03; // and how wide at its widest
  inward = [0, -1]; // across the edge, into the crowd
  seams = 0;
  ids = 0;
  missed = 0;
  view = { scale: 1 };
  pan = [0, 0]; // where the view looks, as a period starts (it is this far from the middle, times the scale, all the time)
  rebase = { count: 0, by: 1 };
  grid = new Map<number, Cell[]>();
  spots = new Map<number, Cell[]>(); // those still on their way to stand, by where they will
  gridSize = 0;
  // how the daughters come to stand: how many, how old, how many had to be hurried, and how far off and how fast they still were when the last correction began
  easeTrace: number[][] | null = null; // (for looking into it: how far each was from its standing pose when it began to be eased to it)
  trace: number[][] | null = null; // (for looking into it: what each daughter was like when places were shared out)
  tally = { stood: 0, age: 0, hurried: 0, began: 0, off: 0, slide: 0, shape: 0, askew: 0, shared: 0, apart: 0, apartMost: 0, changed: 0 };

  constructor() {
    const { K, M, s } = this;
    const N = (this.N = K * M);
    const rand = rng(Math.round(C.seed));
    const e = (C.edge * Math.PI) / 180;
    // the camera stands on the +z side: "up the screen" is -z
    const nx = (this.inward[0] = Math.sin(e)),
      nz = (this.inward[1] = -Math.cos(e));
    const px = (this.px = new Float64Array(N)),
      pz = (this.pz = new Float64Array(N)),
      pr = (this.pr = new Float64Array(N));
    let area = 0;
    for (let j = 0; j < N; j++) {
      pr[j] = 0.94 + 0.12 * rand(); // near enough one size, or six would not fit inside their mother
      area += pr[j] * pr[j];
    }
    // The first M stand within A of the middle, the rest in the band beyond out to A / s: the same
    // share of ground each, so that shrunk by s the whole of it lies within A.
    const part = Math.min(0.92, Math.max(0.12, C.around));
    const A = (this.A = Math.sqrt((area * s * s) / (part * C.packed)));
    // The crowd is a wedge with its point at the middle (the one shape that looks the same however far
    // the view has closed in), this far to each side of the way it faces. How far inside it a point is:
    const half = Math.PI * part;
    const straight = Math.abs(part - 0.5) < 1e-9;
    const sh = straight ? 1 : Math.sin(half),
      ch = straight ? 0 : Math.cos(half);
    const into = [0, 0, 0]; // (and which way further in lies)
    const deep = (x: number, z: number) => {
      const a = x * nx + z * nz,
        side = x * -nz + z * nx;
      const b = Math.abs(side),
        sg = side < 0 ? -1 : 1;
      const line = a * sh - b * ch; // from the nearer of its two edges
      const along = a * ch + b * sh; // and how far along that edge from the point
      if (along >= 0) {
        into[0] = nx * sh - sg * -nz * ch;
        into[1] = nz * sh - sg * nx * ch;
        return line;
      }
      // (nearest the point itself)
      const d = Math.hypot(x, z) || 1e-9;
      const out = line > 0 ? 1 : -1;
      into[0] = (out * x) / d;
      into[1] = (out * z) / d;
      return out * d;
    };
    const rough: number[] = [];
    for (let j = 0; j < N; j++) {
      const inner = j < M;
      for (;;) {
        const a = rand() * Math.PI * 2,
          d = Math.sqrt(inner ? rand() : 1 + rand() * (1 / (s * s) - 1)) * A;
        px[j] = Math.cos(a) * d;
        pz[j] = Math.sin(a) * d;
        if (deep(px[j], pz[j]) > pr[j]) break;
      }
      rough.push((rand() - 0.3) * C.ragged);
    }
    // push them off each other until they stand clear
    for (let it = 0; it < 500; it++) {
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = px[j] - px[i],
            dz = pz[j] - pz[i];
          const need = (pr[i] + pr[j]) * 1.01;
          const d2 = dx * dx + dz * dz;
          if (d2 >= need * need) continue;
          const d = Math.sqrt(d2) || 1e-6;
          const push = ((need - d) / d) * 0.5;
          px[i] -= dx * push;
          pz[i] -= dz * push;
          px[j] += dx * push;
          pz[j] += dz * push;
        }
      }
      for (let j = 0; j < N; j++) {
        // behind the edge (each a little further or nearer than the next: the edge is uneven)
        const over = pr[j] * (0.95 + rough[j]) - deep(px[j], pz[j]);
        if (over > 0) {
          px[j] += into[0] * over;
          pz[j] += into[1] * over;
        }
        // and on its own side of the line between the two bands
        const d = Math.hypot(px[j], pz[j]) || 1e-6;
        const want = j < M ? Math.min(d, A) : Math.min(Math.max(d, A), A / s);
        px[j] *= want / d;
        pz[j] *= want / d;
      }
    }
    // Whose daughter each place's body is: the nearest colony that still has room for one. Then any
    // two are swapped if that brings both nearer home.
    const parent = (this.parent = new Int32Array(N).fill(-1));
    const room = new Int32Array(M).fill(K);
    const pairs: [number, number, number][] = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < M; i++) pairs.push([(px[j] * s - px[i]) ** 2 + (pz[j] * s - pz[i]) ** 2, j, i]);
    pairs.sort((a, b) => a[0] - b[0]);
    for (const [, j, i] of pairs) {
      if (parent[j] >= 0 || !room[i]) continue;
      parent[j] = i;
      room[i]--;
    }
    const far = (j: number, i: number) => (px[j] * s - px[i]) ** 2 + (pz[j] * s - pz[i]) ** 2;
    for (let it = 0; it < N * 400; it++) {
      const a = Math.floor(rand() * N),
        b = Math.floor(rand() * N);
      if (parent[a] === parent[b]) continue;
      if (far(a, parent[b]) + far(b, parent[a]) < far(a, parent[a]) + far(b, parent[b])) {
        const t = parent[a];
        parent[a] = parent[b];
        parent[b] = t;
      }
    }
    // How a colony's daughters sit in it: spread as far from each other as K points on a ball can be
    // (pushed apart until they stop moving), each then as far out as its own size lets it be.
    const even: number[][] = [];
    for (let k = 0; k < K; k++) {
      const y = 1 - ((k + 0.5) / K) * 2,
        r = Math.sqrt(1 - y * y);
      even.push([Math.cos(k * 2.39996) * r, y, Math.sin(k * 2.39996) * r]);
    }
    for (let it = 0; it < 400; it++) {
      for (let a = 0; a < K; a++) {
        const f = [0, 0, 0];
        for (let b = 0; b < K; b++) {
          if (a === b) continue;
          const d = [even[a][0] - even[b][0], even[a][1] - even[b][1], even[a][2] - even[b][2]];
          const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] + 1e-6;
          for (let r = 0; r < 3; r++) f[r] += d[r] / (l2 * l2);
        }
        for (let r = 0; r < 3; r++) even[a][r] += f[r] * 0.02;
        const l = Math.hypot(even[a][0], even[a][1], even[a][2]);
        for (let r = 0; r < 3; r++) even[a][r] /= l;
      }
    }
    // which way up each stands
    const spins = this.spins;
    this.learnt = new Uint8Array(N);
    this.rev = new Int8Array(N);
    this.phase = new Float64Array(N);
    for (let j = 0; j < N; j++) {
      const q = [rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5];
      const l = Math.hypot(q[0], q[1], q[2], q[3]);
      const [x, y, z, w] = q.map((c) => c / l);
      this.turns.push([x, y, z, w]);
      this.starts.push([x, y, z, w]);
      this.rev[j] = (rand() < 0.5 ? -1 : 1) * (rand() < 0.3 ? 2 : 1) * Math.round(C.turns);
      this.phase[j] = rand() * Math.PI * 2;
      this.seeds.push(rand());
      spins.push([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]);
    }
    // Which daughter goes to which place: the pairing with the least to travel in all (any one, then
    // two swapped wherever that is less), found once, so each can sit in her mother at her own size.
    // A colony standing is lower than it is wide, so the litter is turned the way up that reaches least
    // above and below the middle (for six: lying on a face of the octahedron, three below and three
    // above), tried a few hundred ways. In each mother it is then turned only about the upright, by an
    // amount of her own.
    let flat = even,
      least = 9;
    for (let tries = 0; tries < 600; tries++) {
      const q = [rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5];
      const l = Math.hypot(q[0], q[1], q[2], q[3]);
      const [x, y, z, w] = q.map((c) => c / l);
      const m = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
      const turned = even.map((b) => [m[0] * b[0] + m[1] * b[1] + m[2] * b[2], m[3] * b[0] + m[4] * b[1] + m[5] * b[2], m[6] * b[0] + m[7] * b[1] + m[8] * b[2]]);
      const tall = Math.max(...turned.map((b) => Math.abs(b[1])));
      if (tall < least) {
        least = tall;
        flat = turned;
      }
    }
    for (let i = 0; i < M; i++) {
      const places: number[] = [];
      for (let j = 0; j < N; j++) if (parent[j] === i) places.push(j);
      const m = spins[i];
      // Turned about the upright whichever way brings the daughters, as they will roll out from her
      // middle, nearest the places there are for them (tried every five degrees, each with the best
      // pairing): they are not sent to places, but this way they start out towards them.
      let seat: number[][] = [],
        least = 1e99,
        pick = places;
      const mid = [0, 0];
      for (const j of places) {
        mid[0] += (px[j] * s - px[i]) / K;
        mid[1] += (pz[j] * s - pz[i]) / K;
      }
      for (let turn = 0; turn < 72; turn++) {
        const yaw = (turn / 72) * Math.PI * 2;
        const tried = flat.map((b) => [Math.cos(yaw) * b[0] - Math.sin(yaw) * b[2], b[1], Math.sin(yaw) * b[0] + Math.cos(yaw) * b[2]]);
        const order = [...places];
        // (where she would come to rest: out from the middle of the places, about as far as they lie from it)
        const cost = (k: number, j: number) => (px[j] * s - (px[i] + mid[0] + tried[k][0] * pr[i] * 1.5)) ** 2 + (pz[j] * s - (pz[i] + mid[1] + tried[k][2] * pr[i] * 1.5)) ** 2;
        for (let it = 0; it < 12; it++) {
          let swapped = false;
          for (let a = 0; a < K; a++)
            for (let b = a + 1; b < K; b++)
              if (cost(a, order[b]) + cost(b, order[a]) < cost(a, order[a]) + cost(b, order[b]) - 1e-12) {
                const t = order[a];
                order[a] = order[b];
                order[b] = t;
                swapped = true;
              }
          if (!swapped) break;
        }
        let sum = 0;
        for (let k = 0; k < K; k++) sum += cost(k, order[k]);
        if (sum < least) {
          least = sum;
          seat = tried;
          pick = order;
        }
      }
      for (let k = 0; k < K; k++) places[k] = pick[k];
      this.kidsOf.push(places);
      const h = new Float64Array(K * 3),
        w = new Float64Array(K * 3);
      seat.forEach((d, k) => {
        // (kept on her own unit ball, as it is before she is turned the way up she stands: turned back
        // by her turn. In her radii: the daughter's own radius is s times her place's, over her mother's)
        const out = Math.max(0, 0.98 - (s * pr[places[k]]) / pr[i]);
        for (let r = 0; r < 3; r++) h[k * 3 + r] = (m[r] * d[0] + m[3 + r] * d[1] + m[6 + r] * d[2]) * out;
        for (let r = 0; r < 3; r++) w[k * 3 + r] = d[r] * out;
      });
      this.homes.push(h);
      this.seats.push(w);
    }

    // When each bursts. Six daughters cover exactly the ground their mother did, so some of their places
    // lie where a neighbour of hers stands: they can only come to stand if the neighbours burst about
    // when she does. So the bursting goes through the crowd as bands, turning about the point the camera
    // is closing in on, like the hand of a clock: a colony bursts when a band comes round to it, give or
    // take a little. Which way a colony lies from that point is the same for it and for its daughters,
    // so each bursts one period after its mother: time enough to have landed and grown up. There is
    // always a band somewhere in the crowd, so there is always something bursting.
    // A colony far enough out that the view will have closed in past it before its turn does not burst
    // at all (it passes out of view whole), unless the next crowd is born of it.
    const NEVER = -9;
    this.never = NEVER;
    this.when = new Float64Array(M);
    const must = new Uint8Array(M);
    // (the view is the ground within A of where it looks: with no pan, just the first M places)
    const vx = (this.pan[0] = C.panAcross),
      vz = (this.pan[1] = -C.panUp);
    const panned = vx !== 0 || vz !== 0;
    const seen = (j: number) => (panned ? Math.hypot(px[j] - vx, pz[j] - vz) <= A : j < M);
    for (let j = 0; j < N; j++) if (seen(j)) must[parent[j]] = 1;
    const bands = Math.max(1, Math.round(C.bands));
    for (let i = 0; i < M; i++) {
      // round the point, from one end of the crowd's edge (0) to the other (1)
      const across = px[i] * nx + pz[i] * nz,
        along = px[i] * -nz + pz[i] * nx;
      const round = straight ? Math.atan2(across, along) / Math.PI : 0.5 - Math.atan2(along, across) / (2 * half);
      const t = (((round * bands + (rand() - 0.5) * 2 * C.stray) % 1) + 1) % 1;
      this.when[i] = t;
    }
    // A band's time comes round again each period, so "when" is only known up to whole periods: taken
    // as the one nearest its mother's, so that each bursts about a period after she does and never a
    // moment after being let out. (A mother's own time shifts with hers in turn: gone over until it
    // stops changing.)
    const raw = [...this.when];
    for (let pass = 0; pass < 12; pass++) for (let i = 0; i < M; i++) this.when[i] = raw[i] + Math.max(-1, Math.min(1, Math.round(this.when[parent[i]] - raw[i])));
    for (let i = 0; i < M; i++) {
      // where the view will be looking, and how far it will reach, when its turn comes
      const by = Math.pow(s, this.when[i]);
      if (!must[i] && Math.hypot(px[i] - vx * by, pz[i] - vz * by) / A >= C.seen * by) this.when[i] = NEVER;
    }

    this.push = new Float32Array(M * K * 2);
    this.kept = new Float32Array(M * K * 2);
    this.keptShort = new Float32Array(M * K * 2);
    this.keptLands = new Int32Array(M * K);
    this.keptCost = new Float64Array(M).fill(Infinity);
    this.stride = new Float32Array(M).fill(C.teach);
    this.tries = new Uint8Array(M);
    this.lands = new Int32Array(M * K);
    for (let i = 0; i < M; i++) for (let k = 0; k < K; k++) this.lands[i * K + k] = this.kidsOf[i][k];
    this.aims = new Float64Array(M * 2);
    for (let i = 0; i < M; i++)
      for (const j of this.kidsOf[i]) {
        this.aims[i * 2] += (px[j] * s - px[i]) / K;
        this.aims[i * 2 + 1] += (pz[j] * s - pz[i]) / K;
      }
    this.moved = new Uint8Array(N);
    this.stopAfter = new Int32Array(N).fill(-1);
    this.bursts = new Uint8Array(N);
    for (let j = 0; j < M; j++) this.bursts[j] = this.when[j] === NEVER ? 0 : 1;
    this.stops = new Float64Array(M * K * 2).fill(NaN);
    this.feel = new Float64Array(M * K * 4);
    for (let i = 0; i < M * K; i++) this.feel[i * 4] = this.feel[i * 4 + 3] = 1 / C.roll;
    this.short = new Float64Array(M * K * 2).fill(NaN);
    this.best = new Float64Array(M).fill(Infinity);
    this.T = 2 * K + 3;
    this.trial = new Float64Array(M * this.T * K * 2);
    this.missed2 = new Float64Array(M * this.T * K * 2).fill(NaN);
    this.jac = new Float64Array(M * 4 * K * K);
    for (let i = 0; i < M; i++) for (let r = 0; r < 2 * K; r++) this.jac[i * 4 * K * K + r * 2 * K + r] = 1 / C.roll;
    this.step2 = new Float64Array(M * K * 2);
    this.outOf = new Float64Array(M * K * 2);
    const P = (K * (K - 1)) / 2;
    this.close = new Float64Array(M * this.T * P);
    this.closeBest = new Float64Array(M * P);
    this.jacC = new Float64Array(M * P * 2 * K);
    this.waiting = new Int32Array(M);
    this.rounds = new Int32Array(M);
    // (putt: pushes solved beforehand for just this crowd, if there are any)
    if (C.putt && baked.push && baked.lands && baked.sign === sign() && baked.push.length === M * K * 2) {
      this.push.set(baked.push);
      this.lands.set(baked.lands); // (and which daughter goes to which place: the pushes are for those)
    }
    this.shape();
    const most = N + M + 24 + (C.putt && C.lab ? 3200 : 0);
    const n3 = this.mesh.n * 3;
    this.x = new Float32Array(most * n3);
    this.p = new Float32Array(most * n3);
    for (let i = 0; i < most; i++) this.cells.push(new Cell(this.mesh, this.x.subarray(i * n3, (i + 1) * n3), this.p.subarray(i * n3, (i + 1) * n3), K));
    // the first crowd, standing
    for (let i = 0; i < N; i++) {
      if (!(panned ? Math.hypot(px[i] - vx, pz[i] - vz) <= A * 1.1 : i < M)) continue;
      const b = this.spawn(i, 1, [px[i], pr[i], pz[i]], [0, 0, 0])!;
      b.born = -this.TS;
      b.grown = 1;
      this.rest(b);
    }
  }

  spawn(idx: number, sigma: number, at: number[], v: number[], q?: number[]) {
    const R = this.pr[idx] * sigma;
    const cell = this.cells.find((c) => !c.alive && c.freeAt <= this.step);
    if (!cell) {
      this.missed++;
      return null;
    }
    cell.alive = true;
    cell.asleep = false;
    cell.easing = false;
    cell.id = ++this.ids;
    cell.idx = idx;
    cell.sigma = sigma;
    cell.R = cell.R0 = R;
    cell.vol0 = cell.mesh.vol * R * R * R;
    cell.seed = this.seeds[idx];
    cell.born = this.step;
    // its time to burst, counted from when its generation becomes the crowd: the end of this period
    // (the first crowd is that already)
    const w = idx < this.M ? this.when[idx] : this.never;
    const becomes = sigma > 0.99 ? 0 : (Math.floor(this.step / this.TS) + 1) * this.TS;
    cell.due = w === this.never ? -1 : becomes + Math.round(w * this.TS);
    cell.becomes = becomes;
    cell.placed = true;
    cell.from = -1;
    cell.kind = idx;
    cell.grown = 0;
    cell.gone = false;
    cell.prod = null;
    cell.burstAt = -1;
    cell.there = 1;
    cell.grounded = 0;
    cell.tx = this.px[idx] * sigma;
    cell.tz = this.pz[idx] * sigma;
    cell.q0 = [...(q ?? this.turns[idx])];
    cell.ox = cell.oz = 0;
    cell.aimAt = -99;
    cell.shove.fill(0); // (a slot is used again and again: nothing of the last one in it may be left)
    cell.judged = true;
    cell.ghost = 0;
    cell.helped = 0;
    cell.place(at[0], at[1], at[2], cell.q0);
    cell.kick(v[0], v[1], v[2]);
    cell.stirred++;
    this.live.push(cell);
    return cell;
  }

  // Where its daughters are, and how big: they sit still in it, each already the size it will stand at.
  // (One that stands beyond the crowd's reach will never burst, but has daughters to show all the same:
  // it borrows the layout of one that will.)
  settle(b: Cell) {
    const like = b.idx % this.M;
    const h = this.homes[like],
      G = b.G,
      kids = this.kidsOf[like];
    // They shift about a little all the time, each its own way (so many times a period, so that it comes
    // round the same), and more, and faster, in the last moments before their mother bursts.
    const u = ((this.step % this.TS) / this.TS) * Math.PI * 2;
    const soon = b.due >= 0 && !b.gone ? smooth(b.due - C.eagerFor / H, b.due, this.step) : 0;
    // (whole numbers of times a period, or it would not come round the same)
    const f1 = Math.max(1, Math.round(19 * C.eagerPace)),
      f2 = Math.max(1, Math.round(23 * C.eagerPace)),
      f3 = Math.max(1, Math.round(17 * C.eagerPace));
    const sway = C.bob * b.R,
      shake = C.bob * C.eager * b.R * soon;
    for (let k = 0; k < this.K; k++) {
      const a = b.idx * 7.13 + k * 1.7;
      b.inner[k * 3] = b.c[0] + G[0] * h[k * 3] + G[1] * h[k * 3 + 1] + G[2] * h[k * 3 + 2] + sway * Math.sin(3 * u + a) + shake * Math.sin(f1 * u + a * 3.1);
      b.inner[k * 3 + 1] = b.c[1] + G[3] * h[k * 3] + G[4] * h[k * 3 + 1] + G[5] * h[k * 3 + 2] + sway * 0.6 * Math.sin(4 * u + a * 2.1) + shake * 0.6 * Math.sin(f2 * u + a * 1.3);
      b.inner[k * 3 + 2] = b.c[2] + G[6] * h[k * 3] + G[7] * h[k * 3 + 1] + G[8] * h[k * 3 + 2] + sway * Math.sin(5 * u + a * 3.3) + shake * Math.sin(f3 * u + a * 2.3);
      // (putt: the size of the place she will go to: which that is may have been changed)
      b.innerR[k] = (this.pr[C.putt ? this.lands[like * this.K + k] : kids[k]] / this.pr[like]) * b.R * this.s;
    }
  }

  // Let one colony of radius one settle on the floor by itself, and keep the shape it comes to.
  shape() {
    const mesh = this.mesh,
      n = mesh.n;
    const x = new Float32Array(n * 3),
      p = new Float32Array(n * 3);
    const b = new Body(mesh, 1, 0, x, p);
    b.place(0, 1, 0);
    const g = C.gravity * H * H,
      keep = 1 - (C.gravity * H) / C.sink;
    for (let step = 0; step < 600; step++) {
      for (let i = 0; i < n * 3; i += 3) {
        for (let r = 0; r < 3; r++) {
          const v = (x[i + r] - p[i + r]) * keep;
          p[i + r] = x[i + r];
          x[i + r] += v;
        }
        x[i + 1] -= g;
      }
      for (let pass = 0; pass < PASSES; pass++) {
        match(b, Math.min(0.12, C.soft), C.give);
        for (let i = 0; i < n * 3; i += 3) {
          if (x[i + 1] < 0) {
            x[i + 1] = 0;
            p[i] += (x[i] - p[i]) * C.friction;
            p[i + 2] += (x[i + 2] - p[i + 2]) * C.friction;
          }
        }
      }
    }
    // By height on the ball: 33 heights from the bottom to the top, each the mean of the points of the
    // skin near that height, counted less the further off they are. (The points of the mesh come at
    // only so many heights, so "near" has to reach a few steps either way, or some would have none.)
    let top = 0,
      cy = 0;
    for (let i = 0; i < n * 3; i += 3) {
      top = Math.max(top, x[i + 1]);
      cy += x[i + 1] / n;
    }
    for (let k = 0; k < 33; k++) {
      let sw = 0,
        sh = 0,
        count = 0;
      for (let i = 0; i < n * 3; i += 3) {
        const off = ((mesh.dirs[i + 1] + 1) / 2) * 32 - k;
        const w = Math.exp(-off * off * 0.5);
        sw += Math.hypot(x[i] - b.c[0], x[i + 2] - b.c[2]) * w;
        sh += x[i + 1] * w;
        count += w;
      }
      this.wide[k] = sw / count;
      this.high[k] = sh / count;
    }
    // the two poles are on the upright line, at the floor and at the top
    this.wide[0] = this.wide[32] = 0;
    this.high[0] = 0;
    this.high[32] = top;
    this.standY = cy;
    this.squat = top / 2;
    this.widest = Math.max(...this.wide);
  }

  // The nearest clear ground to a place, for a body of a given size: wherever a colony is standing
  // over part of the place, or a bigger one is going to, the point is moved out from under it. A daughter is drawn there, not into
  // the colony; when the colony bursts, the place itself is clear and she rolls on to it.
  clear(R: number, x: number, z: number, out: number[]) {
    out[0] = x;
    out[1] = z;
    for (let again = 0; again < 2; again++) {
      for (const o of this.live) {
        // whatever is standing, and whatever bigger is on its way to stand: where it will be
        // (one about to burst still stands there until it does)
        if (o.gone || !(o.asleep || o.easing || o.prod || o.R > R * 1.5)) continue;
        const dx = out[0] - o.tx,
          dz = out[1] - o.tz;
        const need = o.R * this.widest * 0.97 + R * 0.92;
        const d2 = dx * dx + dz * dz;
        if (d2 >= need * need || o.R < R * 0.7) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-9) out[0] = o.tx + need;
        else {
          out[0] = o.tx + (dx / d) * need;
          out[1] = o.tz + (dz / d) * need;
        }
      }
    }
  }

  // The skin gives, and its daughters are thrown to their places: each aimed to come down where it
  // will stand, a set time from now.
  burst(b: Cell) {
    const dir = b.prod!.dir;
    const Gi = b.Gi;
    const f = [0, 1, 2].map((r) => Gi[r * 3] * dir[0] + Gi[r * 3 + 1] * dir[1] + Gi[r * 3 + 2] * dir[2]);
    const fl = Math.hypot(f[0], f[1], f[2]) || 1;
    b.burstFrom.set(f.map((c) => c / fl));
    b.prod = null;
    b.gone = true;
    b.burstAt = this.step;
    b.freeAt = this.step + Math.round((C.tear + 5.5) / H);
    b.stirred++;
    this.live = this.live.filter((o) => o !== b);
    this.ghosts.push(b);
    const { K, s } = this;
    const sigma = b.sigma * s;
    const kids = this.kidsOf[b.idx];
    // the ones standing round rock away and back (they are told where and when); what is in the air is pushed
    this.jolts.push({ x: b.c[0], z: b.c[2], R: b.R, at: this.step });
    for (const o of this.live) {
      if (o.asleep || o.easing || o.prod) continue;
      const ex = o.c[0] - b.c[0],
        ez = o.c[2] - b.c[2];
      const d = Math.hypot(ex, ez) || 1,
        reach = (b.R + o.R) * 2.2;
      if (d >= reach) continue;
      // (in its own radii: a small one beside a big one bursting is pushed no harder for its size)
      const f = C.blast * o.R * (1 - d / reach) ** 2 * (o.grounded ? C.blastFloor : 1);
      o.shove[0] += (ex / d) * f;
      o.shove[1] += o.grounded ? 0 : 0.3 * f;
      o.shove[2] += (ez / d) * f;
    }
    // They are let out, not thrown: each pushed a little outwards from her mother's middle, and all of
    // them together a little towards the middle of the places there are for them. Then they fall, and
    // roll off each other, wherever that takes them. Which of them has which place is settled after.
    const drag = C.gravity / C.sink;
    const mid = [0, 0];
    if (C.free) {
      // (the places move: the lean is kept as it was first, or the litter would chase where it went last)
      mid[0] = this.aims[b.idx * 2] * b.sigma + b.tx - b.c[0];
      mid[1] = this.aims[b.idx * 2 + 1] * b.sigma + b.tz - b.c[2];
    } else
      for (const j of kids) {
        mid[0] += (this.px[j] * sigma - b.c[0]) / K;
        mid[1] += (this.pz[j] * sigma - b.c[2]) / K;
      }
    // (putt: while the pushes are being solved, unseen tries go out beside the real litter: the pushes
    // so far; each daughter's pushed a little more one way, and then the other, one at a time (so what
    // that does to her sisters is seen too); and one step and half a step of Newton's method from them)
    const m = b.idx;
    const T = this.T;
    const lab = C.putt && C.lab && this.seams < C.labFor && this.waiting[m] === 0;
    if (lab) {
      for (let t = 0; t < T; t++)
        for (let k = 0; k < K; k++) {
          const at = m * K + k,
            to = ((m * T + t) * K + k) * 2;
          let vx = this.push[at * 2],
            vz = this.push[at * 2 + 1];
          if (t >= 1 && t <= 2 * K && (t - 1) >> 1 === k) {
            if ((t - 1) & 1) vz += C.labNudge;
            else vx += C.labNudge;
          }
          if (t > 2 * K) {
            const by = t === 2 * K + 1 ? 1 : 0.5;
            vx += this.step2[at * 2] * by;
            vz += this.step2[at * 2 + 1] * by;
          }
          // (and never more than `backMost` back across her mother, against the way out from where she
          // sits in her: alone, that is a dash through her sisters just as her mother gives)
          const ux = this.outOf[at * 2],
            uz = this.outOf[at * 2 + 1],
            ul = Math.hypot(ux, uz);
          if (ul > 1e-9) {
            const back = -(vx * ux + vz * uz) / ul;
            if (back > C.backMost) {
              vx += ((back - C.backMost) * ux) / ul;
              vz += ((back - C.backMost) * uz) / ul;
            }
          }
          const v = Math.hypot(vx, vz);
          if (v > C.puttPush) {
            vx *= C.puttPush / v;
            vz *= C.puttPush / v;
          }
          this.trial[to] = vx;
          this.trial[to + 1] = vz;
          this.missed2[to] = this.missed2[to + 1] = NaN;
        }
      this.close.fill(0, m * T * ((K * (K - 1)) / 2), (m + 1) * T * ((K * (K - 1)) / 2));
      this.rounds[m]++;
    }
    for (let k = 0; k < K; k++) {
      const j = this.lands[b.idx * K + k];
      if (C.free) this.stops[(b.idx * K + k) * 2] = NaN;
      const at = [b.inner[k * 3], b.inner[k * 3 + 1], b.inner[k * 3 + 2]];
      if (lab) {
        this.outOf[(m * K + k) * 2] = (at[0] - b.tx) / b.sigma;
        this.outOf[(m * K + k) * 2 + 1] = (at[2] - b.tz) / b.sigma;
      }
      const ex = at[0] - b.c[0],
        ey = at[1] - b.c[1],
        ez = at[2] - b.c[2];
      const out = (C.pop * b.R) / (Math.hypot(ex, ey, ez) || 1);
      // (the water slows the lean all the way: it is given as much more as that will cost)
      // and the push her position has learnt will roll her to her place
      // (free: once rehearsals are over, the best of them)
      const learnt = C.free && this.seams >= C.freeTeach ? this.kept : this.push;
      const px = learnt[(b.idx * K + k) * 2] * b.sigma,
        pz = learnt[(b.idx * K + k) * 2 + 1] * b.sigma;
      const kid = this.spawn(j, sigma, at, [ex * out + mid[0] * C.lean * drag + px, ey * out, ez * out + mid[1] * C.lean * drag + pz], this.starts[j]);
      if (kid) {
        kid.litter = b.id;
        kid.from = b.idx;
        kid.slot = k;
        kid.kind = b.idx * K + k;
        kid.placed = false;
        kid.fixed = C.putt ? !C.lab || this.seams >= C.labFor : C.free ? this.seams >= C.freeTeach : this.tries[b.idx] >= C.teachFor; // (free: every learner keeps to one clock, the periods: one judged now and then would go on learning long after the rest)
        kid.judged = false;
        this.settle(kid);
      }
      if (!lab) continue;
      for (let t = 0; t < T; t++) {
        const to = ((m * T + t) * K + k) * 2;
        const gx = this.trial[to] * b.sigma,
          gz = this.trial[to + 1] * b.sigma;
        const g = this.spawn(j, sigma, at, [ex * out + mid[0] * C.lean * drag + gx, ey * out, ez * out + mid[1] * C.lean * drag + gz], this.starts[j]);
        if (!g) continue;
        g.litter = 1e7 + this.ghostIds * T + t; // (each try its own litter: its daughters roll off each other, and nothing else)
        g.ghost = t + 1;
        g.from = m;
        g.slot = k;
        g.kind = m * K + k;
        g.placed = true;
        g.due = -1;
        this.waiting[m]++;
      }
    }
    if (lab) this.ghostIds++;
  }

  // (putt) An unseen try has stopped (or gone out of view: then `x` is NaN): how far short of where she
  // should stand she is, in her mother's measure. When the round is in, it is judged.
  tried(g: Cell, x: number, z: number) {
    const { K, s, T } = this;
    const m = g.from,
      t = g.ghost - 1;
    const to = ((m * T + t) * K + g.slot) * 2;
    const mother = g.sigma / s;
    const aim = [0, 0];
    if (!Number.isNaN(x)) this.clear(g.R, g.tx, g.tz, aim);
    this.missed2[to] = Number.isNaN(x) ? NaN : (aim[0] - x) / mother;
    this.missed2[to + 1] = Number.isNaN(x) ? NaN : (aim[1] - z) / mother;
    if (--this.waiting[m] > 0) return;
    const n = 2 * K;
    const at0 = (k: number, tt: number) => ((m * T + tt) * K + k) * 2;
    const miss = (tt: number, r: number) => this.missed2[at0(r >> 1, tt) + (r & 1)];
    // How where each stops moves with each push, sisters and all: from each nudged try against the plain one
    const J = this.jac.subarray(m * n * n, (m + 1) * n * n);
    for (let c = 0; c < n; c++)
      for (let r = 0; r < n; r++) {
        const d = -(miss(c + 1, r) - miss(0, r)) / C.labNudge;
        if (Number.isFinite(d)) J[r * n + c] = this.rounds[m] > 1 ? 0.5 * J[r * n + c] + 0.5 * d : d;
      }
    // and how near sisters come to each other
    const P = (K * (K - 1)) / 2,
      w2 = C.gapWeight * C.gapWeight;
    const near = (tt: number, q: number) => this.close[(m * T + tt) * P + q];
    const JC = this.jacC.subarray(m * P * n, (m + 1) * P * n);
    for (let c = 0; c < n; c++)
      for (let q = 0; q < P; q++) {
        const d = (near(c + 1, q) - near(0, q)) / C.labNudge;
        JC[q * n + c] = this.rounds[m] > 1 ? 0.5 * JC[q * n + c] + 0.5 * d : d;
      }
    // the best try for the litter as a whole
    let pick = 0,
      least = Infinity;
    const costs: number[] = [];
    for (let tt = 0; tt < T; tt++) {
      let sum = 0,
        count = 0;
      for (let r = 0; r < n; r++) {
        const v = miss(tt, r);
        if (Number.isNaN(v) || Number.isNaN(miss(0, r))) continue;
        sum += v * v;
        count++;
      }
      for (let q = 0; q < P; q++) sum += w2 * near(tt, q) ** 2;
      const cost = count ? (sum / count) * 2 : Infinity;
      costs.push(cost);
      if (cost < least) {
        least = cost;
        pick = tt;
      }
    }
    if (this.labLog) this.labLog.push([m, this.seams, pick === 0 ? 0 : pick <= n ? 1 : pick === n + 1 ? 3 : 4, Math.sqrt(costs[0]), Math.sqrt(least)]);
    if (!Number.isFinite(least)) return;
    for (let k = 0; k < K; k++) {
      const a = at0(k, pick),
        at = m * K + k;
      this.push[at * 2] = this.trial[a];
      this.push[at * 2 + 1] = this.trial[a + 1];
      this.short[at * 2] = this.missed2[a];
      this.short[at * 2 + 1] = this.missed2[a + 1];
    }
    for (let q = 0; q < P; q++) this.closeBest[m * P + q] = near(pick, q);
    this.best[m] = least;
    // Early on, which daughter goes to which place may change: where each stops is known, and how her
    // own push moves that, so every way of sharing the places out is tried for the least push in all.
    if (this.rounds[m] <= C.shareFor && !this.short.subarray(m * K * 2, (m + 1) * K * 2).some(Number.isNaN)) {
      const places = this.kidsOf[m];
      const stop: number[][] = [];
      for (let k = 0; k < K; k++) {
        const at = m * K + k,
          j = this.lands[at];
        stop.push([this.px[j] * s - this.short[at * 2], this.pz[j] * s - this.short[at * 2 + 1]]);
      }
      const need = (k: number, j: number) => {
        const r = 2 * k;
        const a = J[r * n + r],
          b2 = J[r * n + r + 1],
          c = J[(r + 1) * n + r],
          d = J[(r + 1) * n + r + 1];
        const det = a * d - b2 * c || 1e-9;
        const sx = this.px[j] * s - stop[k][0],
          sz = this.pz[j] * s - stop[k][1];
        const at = m * K + k;
        const vx = this.push[at * 2] + (d * sx - b2 * sz) / det,
          vz = this.push[at * 2 + 1] + (-c * sx + a * sz) / det;
        // (and never back across her mother: a push against the way out from where she sits in her
        // throws her through her sisters just as her mother gives)
        const ux = this.outOf[at * 2],
          uz = this.outOf[at * 2 + 1];
        const back = Math.max(0, -(vx * ux + vz * uz) / (Math.hypot(ux, uz) || 1));
        return vx * vx + vz * vz + C.inward * back * back;
      };
      // (and no two of them sent across each other's way: from where each is let out to her place, as
      // straight lines, which must not cross. Where they would, they meet on the way and both go astray)
      // (the mother's place, in her own measure, is just where it is: her daughters' are s times theirs)
      const ox = (k: number) => this.px[m] + this.outOf[(m * K + k) * 2],
        oz = (k: number) => this.pz[m] + this.outOf[(m * K + k) * 2 + 1];
      const side = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
      const toSeg = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
        const ux = bx - ax,
          uz = bz - az;
        const f = Math.max(0, Math.min(1, ((px - ax) * ux + (pz - az) * uz) / (ux * ux + uz * uz || 1e-12)));
        return Math.hypot(ax + ux * f - px, az + uz * f - pz);
      };
      const cross = (k: number, j: number, l: number, i: number) => {
        let ax = ox(k),
          az = oz(k),
          cx = ox(l),
          cz = oz(l);
        const bx = this.px[j] * s,
          bz = this.pz[j] * s,
          dx = this.px[i] * s,
          dz = this.pz[i] * s;
        if (side(ax, az, bx, bz, cx, cz) * side(ax, az, bx, bz, dx, dz) < 0 && side(cx, cz, dx, dz, ax, az) * side(cx, cz, dx, dz, bx, bz) < 0) return true;
        if (!C.crossNear) return false;
        // (or pass near each other: from a third of the way, when they are out of their mother, nearer than their two radii)
        ax += (bx - ax) / 3;
        az += (bz - az) / 3;
        cx += (dx - cx) / 3;
        cz += (dz - cz) / 3;
        const near = Math.min(toSeg(ax, az, cx, cz, dx, dz), toSeg(bx, bz, cx, cz, dx, dz), toSeg(cx, cz, ax, az, bx, bz), toSeg(dx, dz, ax, az, bx, bz));
        return near < C.crossNear * (this.pr[j] + this.pr[i]) * s;
      };
      const order = new Int32Array(K),
        taken = new Uint8Array(K),
        chosen = new Int32Array(K);
      let low = Infinity;
      const go = (k: number, sum: number) => {
        if (sum >= low) return;
        if (k === K) {
          low = sum;
          chosen.set(order);
          return;
        }
        for (let c = 0; c < K; c++) {
          if (taken[c]) continue;
          let crossings = 0;
          for (let l = 0; l < k; l++) if (cross(k, places[c], l, places[order[l]])) crossings++;
          taken[c] = 1;
          order[k] = c;
          go(k + 1, sum + need(k, places[c]) + crossings * C.crossCost);
          taken[c] = 0;
        }
      };
      go(0, 0);
      for (let k = 0; k < K; k++) {
        const at = m * K + k,
          j = places[chosen[k]];
        this.lands[at] = j;
        this.short[at * 2] = this.px[j] * s - stop[k][0];
        this.short[at * 2 + 1] = this.pz[j] * s - stop[k][1];
      }
    }
    // The next step: the change of pushes that moves where they stop by what they are short, as near as
    // the feel says (damped, so that where it is unsure it asks for little: Levenberg-Marquardt)
    const A = new Float64Array(n * n),
      rhs = new Float64Array(n);
    let tr = 0;
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) tr += J[k * n + i] ** 2;
    const lambda = (0.05 * tr) / n + 1e-6;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let v = 0;
        for (let k = 0; k < n; k++) v += J[k * n + i] * J[k * n + j];
        for (let q = 0; q < P; q++) v += w2 * JC[q * n + i] * JC[q * n + j];
        A[i * n + j] = v + (i === j ? lambda : 0);
      }
      let v = 0;
      for (let k = 0; k < n; k++) {
        const sh = this.short[m * K * 2 + k];
        v += J[k * n + i] * (Number.isNaN(sh) ? 0 : sh);
      }
      // (nearness wants to go to nothing: down the way it rises)
      for (let q = 0; q < P; q++) v -= w2 * JC[q * n + i] * this.closeBest[m * P + q];
      rhs[i] = v;
    }
    const step = solve(A, rhs, n);
    for (let i = 0; i < n; i++) this.step2[m * n + i] = step[i];
  }

  // The daughters of one burst have fallen and rolled where they would: now each is given the place
  // nearest where she is, taking all of them together (every way of sharing the places out is tried,
  // and the one with the least to travel in all is taken).
  //
  // Each generation is also a rehearsal for the one after. A litter is let out with a push for each
  // daughter; how far short of her place each then is says what to push harder. If they came nearer
  // in all than at any time before, that is kept, and the next are let out with those pushes and some
  // of the shortfall; if not, with the best so far and half as much of its shortfall. After a few
  // rehearsals the best is what is done from then on, each daughter to the place she took that time:
  // so it comes to be the same every time, as a loop needs.
  share(litter: Cell[]) {
    const K = this.K;
    const m = litter[0].from;
    const places = this.kidsOf[m];
    const n = litter.length;
    if (C.free || C.putt) {
      // (each keeps the place she was let out for: free, it will be moved to her, not she to it; putt, her push takes her there)
      for (const b of litter) {
        b.placed = true;
        b.aimAt = -99;
        b.stirred++;
      }
      return;
    }
    const far = litter.map((b) => places.map((j) => (this.px[j] * b.sigma - b.c[0]) ** 2 + (this.pz[j] * b.sigma - b.c[2]) ** 2));
    const best = new Int32Array(n);
    const rehearsal = this.tries[m] < C.teachFor && !litter[0].fixed;
    let least = 1e99;
    if (!litter[0].fixed) {
      const taken = new Uint8Array(places.length),
        now = new Int32Array(n);
      const go = (k: number, sum: number) => {
        if (sum >= least) return;
        if (k === n) {
          least = sum;
          best.set(now);
          return;
        }
        for (let c = 0; c < places.length; c++) {
          if (taken[c]) continue;
          taken[c] = 1;
          now[k] = c;
          go(k + 1, sum + far[k][c]);
          taken[c] = 0;
        }
      };
      go(0, 0);
    } else litter.forEach((b, k) => (best[k] = places.indexOf(b.idx)));
    const mother = litter[0].sigma / this.s;
    const drag = C.gravity / C.sink;
    // (a litter at the edge of the view may have lost some already: it goes by what each of the rest was short)
    const better = rehearsal && least / (mother * mother) / n < this.keptCost[m];
    if (better) {
      this.keptCost[m] = least / (mother * mother) / n;
      for (let k = 0; k < K; k++) this.keptLands[m * K + k] = -1;
    }
    litter.forEach((b, k) => {
      const j = places[best[k]];
      const off = Math.sqrt(far[k][best[k]]) / b.R;
      if (this.trace)
        this.trace.push([
          b.from,
          b.slot,
          j,
          off,
          Math.hypot(this.push[(m * K + b.slot) * 2], this.push[(m * K + b.slot) * 2 + 1]),
          Math.hypot(b.c[0] - this.px[m] * mother, b.c[2] - this.pz[m] * mother) / b.R,
          Math.hypot(this.px[j] * b.sigma - this.px[m] * mother, this.pz[j] * b.sigma - this.pz[m] * mother) / b.R,
          n,
          b.c[1] / b.R,
          b.fixed ? 1 : 0,
        ]);
      this.tally.shared++;
      this.tally.apart += off;
      this.tally.apartMost = Math.max(this.tally.apartMost, off);
      b.placed = true;
      if (j !== b.idx) {
        this.tally.changed++;
        b.idx = j;
        const w = j < this.M ? this.when[j] : this.never;
        b.due = w === this.never ? -1 : b.becomes + Math.round(w * this.TS);
      }
      b.tx = this.px[j] * b.sigma;
      b.tz = this.pz[j] * b.sigma;
      if (better) {
        const at = m * K + b.slot;
        this.kept[at * 2] = this.push[at * 2];
        this.kept[at * 2 + 1] = this.push[at * 2 + 1];
        // (as a push: what the water would take off it on the way is added)
        this.keptShort[at * 2] = ((b.tx - b.c[0]) * drag) / mother;
        this.keptShort[at * 2 + 1] = ((b.tz - b.c[2]) * drag) / mother;
        this.keptLands[at] = j;
      }
      b.aimAt = -99;
      b.stirred++;
    });
    if (!rehearsal) return;
    if (!better) this.stride[m] *= 0.5;
    this.tries[m]++;
    const last = this.tries[m] >= C.teachFor;
    for (let k = 0; k < K; k++) {
      const at = m * K + k;
      let vx = this.kept[at * 2] + (last ? 0 : this.keptShort[at * 2] * this.stride[m]),
        vz = this.kept[at * 2 + 1] + (last ? 0 : this.keptShort[at * 2 + 1] * this.stride[m]);
      const v = Math.hypot(vx, vz);
      if (v > C.pushMost) {
        vx *= C.pushMost / v;
        vz *= C.pushMost / v;
      }
      this.push[at * 2] = vx;
      this.push[at * 2 + 1] = vz;
    }
    // which place each is let out for: the one she took at best, and for any who were not there then,
    // the places nobody took, in order
    if (this.keptCost[m] < Infinity) {
      const free = places.filter((j) => {
        for (let k = 0; k < K; k++) if (this.keptLands[m * K + k] === j) return false;
        return true;
      });
      for (let k = 0; k < K; k++) this.lands[m * K + k] = this.keptLands[m * K + k] >= 0 ? this.keptLands[m * K + k] : free.shift()!;
    }
  }

  // (free) A litter has all come to rest: the rehearsal is judged by how far from her place each daughter
  // whose colony will burst stopped (the others take where they stopped as their place, and do not count).
  // Kept if nearer in all than ever before, as `share` does, and the next let out with some of the shortfall.
  judge(m: number) {
    const { K, s } = this;
    const drag = C.gravity / C.sink;
    let cost = 0,
      count = 0;
    for (let k = 0; k < K; k++) {
      const at = m * K + k,
        j = this.lands[at];
      if (!this.bursts[j] || Number.isNaN(this.stops[at * 2])) continue;
      // (in the mother's radii: a daughter's place, at a period's start, is in her own)
      const dx = (this.px[j] - this.stops[at * 2]) * s,
        dz = (this.pz[j] - this.stops[at * 2 + 1]) * s;
      cost += dx * dx + dz * dz;
      count++;
    }
    if (this.tries[m] >= C.freeTeach) return;
    cost = count ? cost / count : 0;
    const better = cost < this.keptCost[m];
    if (better) {
      this.keptCost[m] = cost;
      for (let k = 0; k < K; k++) {
        const at = m * K + k,
          j = this.lands[at];
        this.kept[at * 2] = this.push[at * 2];
        this.kept[at * 2 + 1] = this.push[at * 2 + 1];
        const ok = this.bursts[j] && !Number.isNaN(this.stops[at * 2]);
        // (as a push: what the water would take off it on the way is added)
        this.keptShort[at * 2] = ok ? (this.px[j] - this.stops[at * 2]) * s * drag : 0;
        this.keptShort[at * 2 + 1] = ok ? (this.pz[j] - this.stops[at * 2 + 1]) * s * drag : 0;
      }
    } else this.stride[m] *= 0.5;
    this.tries[m]++;
    const last = this.tries[m] >= C.freeTeach;
    for (let k = 0; k < K; k++) {
      const at = m * K + k;
      let vx = this.kept[at * 2] + (last ? 0 : this.keptShort[at * 2] * this.stride[m]),
        vz = this.kept[at * 2 + 1] + (last ? 0 : this.keptShort[at * 2 + 1] * this.stride[m]);
      const v = Math.hypot(vx, vz);
      if (v > C.freePushMost) {
        vx *= C.freePushMost / v;
        vz *= C.freePushMost / v;
      }
      this.push[at * 2] = vx;
      this.push[at * 2 + 1] = vz;
    }
  }

  // Everything by times about the middle of the view.
  grow(by: number) {
    for (const a of [this.x, this.p]) for (let i = 0; i < a.length; i++) a[i] *= by;
    for (const c of this.cells) {
      for (let r = 0; r < 3; r++) {
        c.c[r] *= by;
        c.was[r] *= by;
      }
      c.R *= by;
      c.R0 *= by;
      c.sigma *= by;
      c.tx *= by;
      c.tz *= by;
      c.ox *= by;
      c.oz *= by;
      c.aimX *= by;
      for (let r = 0; r < 3; r++) c.shove[r] *= by;
      c.aimZ *= by;
      for (let k = 0; k < 9; k++) c.g0[k] *= by;
      for (let k = 0; k < 3; k++) c.c0[k] *= by;
      c.shown[0] = NaN;
      c.vol0 *= by * by * by;
      for (let k = 0; k < 9; k++) {
        c.G[k] *= by;
        c.Gi[k] /= by;
      }
      for (let k = 0; k < c.inner.length; k++) c.inner[k] *= by;
      for (let k = 0; k < c.innerR.length; k++) c.innerR[k] *= by;
      c.stirred++;
    }
    for (const j of this.jolts) {
      j.x *= by;
      j.z *= by;
      j.R *= by;
    }
    this.gridSize = 0; // (the squares of the floor are out of date until they are made again)
    this.rebase = { count: this.rebase.count + 1, by };
  }

  // How a colony is turned as it stands, this moment: the way up its place has, turned about the
  // upright by as much as the time of the period says (a whole number of turns a period, so a period
  // on it is the same); and how far it is rocked from its place by what has burst near it lately.
  pose(b: Cell) {
    const a = ((this.step % this.TS) / this.TS) * Math.PI * 2 * this.rev[b.idx] + this.phase[b.idx];
    b.yaw = a;
    const c = Math.cos(a),
      sn = Math.sin(a);
    const m = this.spins[b.idx],
      o = b.lie;
    for (let k = 0; k < 3; k++) {
      o[k] = c * m[k] + sn * m[6 + k];
      o[3 + k] = m[3 + k];
      o[6 + k] = -sn * m[k] + c * m[6 + k];
    }
    const t = this.turns[b.idx],
      ch = Math.cos(a / 2),
      sh = Math.sin(a / 2);
    b.lieQ[0] = ch * t[0] + sh * t[2];
    b.lieQ[1] = ch * t[1] + sh * t[3];
    b.lieQ[2] = ch * t[2] - sh * t[0];
    b.lieQ[3] = ch * t[3] - sh * t[1];
    let ox = 0,
      oz = 0;
    for (const j of this.jolts) {
      const dx = b.tx - j.x,
        dz = b.tz - j.z;
      const d = Math.hypot(dx, dz),
        reach = (j.R + b.R) * 2.4;
      if (d >= reach || d < 1e-9) continue;
      const t = (this.step - j.at) * H;
      const amount = (C.flinch * j.R * (1 - d / reach) ** 2 * Math.exp(-C.flinchFade * t) * Math.sin(C.flinchRate * t)) / d;
      ox += dx * amount;
      oz += dz * amount;
    }
    b.ox = ox;
    b.oz = oz;
  }
  standAs(b: Cell) {
    // (as `pose` will turn it about the upright at this moment)
    const a = ((this.step % this.TS) / this.TS) * Math.PI * 2 * this.rev[b.idx] + this.phase[b.idx],
      q = b.q;
    const ch = Math.cos(a / 2),
      sh = Math.sin(a / 2);
    // turned back about the upright by as much as `pose` will turn it
    const x = ch * q[0] - sh * q[2],
      y = ch * q[1] - sh * q[3],
      z = ch * q[2] + sh * q[0],
      w = ch * q[3] + sh * q[1];
    const l = Math.hypot(x, y, z, w) || 1;
    const t = [x / l, y / l, z / l, w / l];
    this.turns[b.idx] = t;
    const m = [
      1 - 2 * (t[1] * t[1] + t[2] * t[2]),
      2 * (t[0] * t[1] - t[2] * t[3]),
      2 * (t[0] * t[2] + t[1] * t[3]),
      2 * (t[0] * t[1] + t[2] * t[3]),
      1 - 2 * (t[0] * t[0] + t[2] * t[2]),
      2 * (t[1] * t[2] - t[0] * t[3]),
      2 * (t[0] * t[2] - t[1] * t[3]),
      2 * (t[1] * t[2] + t[0] * t[3]),
      1 - 2 * (t[0] * t[0] + t[1] * t[1]),
    ];
    this.spins[b.idx] = m;
    if (b.idx >= this.M) return;
    const h = this.homes[b.idx],
      d = this.seats[b.idx];
    for (let k = 0; k < this.K; k++) for (let r = 0; r < 3; r++) h[k * 3 + r] = m[r] * d[k * 3] + m[3 + r] * d[k * 3 + 1] + m[6 + r] * d[k * 3 + 2];
  }

  // Where a point of its skin is when it stands: the shape a colony settles to by itself on the floor,
  // in its place, turned as `pose` has it. Every colony with its number, of every generation, stands
  // exactly so at the same moment of a period: nothing of how it got there is left in it.
  stand(b: Cell, i: number, out: number[]) {
    const m = b.lie,
      d = b.mesh.dirs;
    const dx = m[0] * d[i] + m[1] * d[i + 1] + m[2] * d[i + 2],
      dy = m[3] * d[i] + m[4] * d[i + 1] + m[5] * d[i + 2],
      dz = m[6] * d[i] + m[7] * d[i + 1] + m[8] * d[i + 2];
    const u = Math.min(31.999, Math.max(0, ((dy + 1) / 2) * 32));
    const k = Math.floor(u),
      f = u - k;
    const round = Math.sqrt(dx * dx + dz * dz) || 1;
    const w = (b.R * (this.wide[k] * (1 - f) + this.wide[k + 1] * f)) / round;
    out[0] = b.tx + b.ox + dx * w;
    out[1] = b.R * (this.high[k] * (1 - f) + this.high[k + 1] * f);
    out[2] = b.tz + b.oz + dz * w;
  }
  // A standing colony, this moment: every point of it, its middle, how it lies, where its daughters are.
  keep(b: Cell) {
    this.pose(b);
    // (nothing to set out again if it is neither turned nor rocked from how it was last set out)
    if (b.shown[0] !== b.yaw || b.shown[1] !== b.ox || b.shown[2] !== b.oz) {
      b.shown[0] = b.yaw;
      b.shown[1] = b.ox;
      b.shown[2] = b.oz;
      const { x, p } = b;
      const at = [0, 0, 0];
      for (let i = 0; i < b.n * 3; i += 3) {
        this.stand(b, i, at);
        p[i] = x[i];
        p[i + 1] = x[i + 1];
        p[i + 2] = x[i + 2];
        x[i] = at[0];
        x[i + 1] = at[1];
        x[i + 2] = at[2];
      }
      b.was.set(b.c);
      b.qWas.set(b.q);
      // how it lies: as it lay when it came to stand, turned by as much as it has turned since
      const a = b.yaw - b.yaw0;
      const c = Math.cos(a),
        sn = Math.sin(a),
        g = b.g0;
      for (let k = 0; k < 3; k++) {
        b.G[k] = c * g[k] + sn * g[6 + k];
        b.G[3 + k] = g[3 + k];
        b.G[6 + k] = -sn * g[k] + c * g[6 + k];
      }
      b.c[0] = b.tx + b.ox + c * b.c0[0] + sn * b.c0[2];
      b.c[1] = b.c0[1];
      b.c[2] = b.tz + b.oz - sn * b.c0[0] + c * b.c0[2];
      b.q.set(b.lieQ);
      b.stirred++;
    }
    this.settle(b);
  }
  rest(b: Cell) {
    this.pose(b);
    const { x, p } = b;
    const at = [0, 0, 0];
    for (let i = 0; i < b.n * 3; i += 3) {
      this.stand(b, i, at);
      x[i] = p[i] = at[0];
      x[i + 1] = p[i + 1] = at[1];
      x[i + 2] = p[i + 2] = at[2];
    }
    // Where its middle is and how it lies are worked out from its points, the same way as while it was
    // moving (gone over until it no longer changes, so that it is the same whatever it was doing just
    // before): where its daughters sit in it follows from these, and they must not jump as it stops.
    for (let again = 0; again < 4; again++) match(b, 0, C.give);
    b.g0.set(b.G);
    b.c0 = [b.c[0] - b.tx - b.ox, b.c[1], b.c[2] - b.tz - b.oz];
    b.yaw0 = b.yaw;
    b.shown = [b.yaw, b.ox, b.oz];
    b.was.set(b.c);
    b.qWas.set(b.q);
    b.easing = false;
    b.asleep = true;
    b.stirred++;
    this.settle(b);
  }

  tick() {
    const { TS, K, s } = this;
    // A period is over: everything is made bigger, and the crowd there is now is given its times to
    // burst. Nothing else happens here: bursts and landings carry straight on through.
    if (this.step > 0 && this.step % TS === 0) {
      this.grow(1 / s);
      this.seams++;
    }
    const u = (this.step % TS) / TS;
    this.view.scale = Math.pow(s, u);
    if (this.jolts.length && (this.step - this.jolts[0].at) * H > 3) this.jolts.shift();
    // whatever the view has closed in past is dropped: it will not be seen again
    if (this.step % 8 === 0) {
      const reach = this.A * this.view.scale * 1.1;
      const ax = this.pan[0] * this.view.scale,
        az = this.pan[1] * this.view.scale;
      let any = false;
      for (const b of this.live) {
        if (Math.hypot(b.c[0] - ax, b.c[2] - az) - b.R > reach && Math.hypot(b.tx - ax, b.tz - az) > reach && !b.prod) {
          if (b.ghost) this.tried(b, NaN, NaN);
          b.alive = false;
          b.freeAt = this.step;
          b.stirred++;
          any = true;
        }
      }
      if (any) this.live = this.live.filter((b) => b.alive);
    }
    const fuse = Math.round(C.fuse / H);
    const damp = (C.gravity * H) / C.sink;

    for (const b of this.live) {
      // (only one that is standing: one whose turn comes while it is still finding its place bursts as
      // soon as it stands. Its daughters are laid out in it for the way it stands.)
      if (b.due >= 0 && this.step >= b.due - fuse && !b.prod && b.asleep) {
        b.prod = { t: 0, dir: POKE };
        b.asleep = false;
        invert(b.G, b.Gi);
      }
    }
    for (const b of [...this.live]) {
      const pr = b.prod;
      if (!pr) continue;
      const [dx, dy, dz] = pr.dir;
      const push = (C.dent * b.R * H) / C.fuse;
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
      if (pr.t >= C.fuse - 1e-9) this.burst(b);
    }
    for (const b of [...this.ghosts]) {
      const { x, p } = b;
      if ((this.step - b.burstAt) * H > C.tear + 0.15) {
        for (let i = 0; i < b.n * 3; i += 3) {
          x[i] = p[i] = b.c[0];
          x[i + 1] = p[i + 1] = b.c[1];
          x[i + 2] = p[i + 2] = b.c[2];
        }
        this.ghosts = this.ghosts.filter((o) => o !== b);
      } else {
        for (let i = 0; i < b.n * 3; i++) {
          const v = (x[i] - p[i]) * 0.95;
          p[i] = x[i];
          x[i] += v;
        }
      }
      b.stirred++;
    }
    for (const c of this.cells) if (c.alive && c.gone && c.freeAt <= this.step) c.alive = false;

    // what is awake: thrown, falling, finding its place
    const awake: Cell[] = [];
    let big = 0;
    for (const b of this.live) {
      const age = this.step - b.born;
      b.grown = Math.max(b.grown, smooth(C.matureFrom, C.matureBy, age / TS));
      if (b.R > big) big = b.R;
      if (b.asleep && !b.prod) {
        // (once every other step: there are two steps to a picture)
        if ((this.step & 1) === 0) this.keep(b);
      } else if (b.easing) {
        // carried to how it stands
        this.pose(b);
        const f = smooth(0, C.easeFor, (this.step - b.easedAt) * H);
        const { x, p } = b;
        const at = [0, 0, 0];
        for (let i = 0; i < b.n * 3; i += 3) {
          this.stand(b, i, at);
          for (let r = 0; r < 3; r++) x[i + r] = p[i + r] + (at[r] - p[i + r]) * f;
        }
        if (f >= 1) {
          this.tally.stood++;
          this.tally.age += age * H;
          this.rest(b);
        } else {
          match(b, 0, C.give); // only to know where its middle is and how it lies, for its daughters
          this.settle(b);
          b.stirred++;
        }
      } else awake.push(b);
    }
    for (const b of awake) {
      const { x, p, n } = b;
      const nb = b.mesh.nbr;
      const gy = -C.gravity * H * H * b.sigma;
      b.was.set(b.c);
      b.qWas.set(b.q);
      b.grounded = 0;
      const n3 = n * 3;
      for (let i = 0, j = 0; i < n3; i += 3, j++) {
        vx[j] = x[i] - p[i];
        vy[j] = x[i + 1] - p[i + 1];
        vz[j] = x[i + 2] - p[i + 2];
      }
      const keep = 1 - damp,
        rip = C.ripple;
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
        x[i] += (vx[j] + (sx / m - vx[j]) * rip) * keep;
        x[i + 1] += (vy[j] + (sy / m - vy[j]) * rip) * keep + gy;
        x[i + 2] += (vz[j] + (sz / m - vz[j]) * rip) * keep;
      }
      b.stirred++;
    }

    // who is near whom: a square of the floor each, as wide as the biggest two side by side
    const size = Math.max(1e-6, big * 2.7);
    this.gridSize = size;
    const grid = this.grid;
    grid.clear();
    for (const b of this.live) {
      const key = (Math.floor(b.c[0] / size) + 2048) * 4096 + Math.floor(b.c[2] / size) + 2048;
      const list = grid.get(key);
      if (list) list.push(b);
      else grid.set(key, [b]);
    }
    // A bigger one still on its way to stand somewhere: the ground it will stand on is kept for it, as
    // if it stood there already (coming to be so over its first second). Smaller ones falling near do
    // not touch it itself, so that each burst stays a thing of its own; but without this they came
    // down on its place, and were crushed and shot out when it came to stand.
    const spots = this.spots;
    spots.clear();
    let least = Infinity;
    for (const b of awake) least = Math.min(least, b.R);
    for (const b of awake) {
      // (only those there is something smaller about to fall near)
      if (b.prod || !b.litter || b.ghost || b.R < least * 1.5) continue;
      const key = (Math.floor(b.tx / size) + 2048) * 4096 + Math.floor(b.tz / size) + 2048;
      const list = spots.get(key);
      if (list) list.push(b);
      else spots.set(key, [b]);
    }
    for (let pass = 0; pass < PASSES; pass++) {
      for (const b of awake) {
        const rel = b.R / b.sigma;
        // (a young one is tauter: it gives less when it lands, and loosens as it finds its place)
        const taut = 1 + C.taut * (1 - smooth(0.7, 2.2, (this.step - b.born) * H));
        match(b, Math.min(0.16, (C.soft / (rel * rel)) * taut), C.give);
        const { x, p } = b;
        let hit = 0;
        for (let i = 0; i < b.n * 3; i += 3) {
          if (x[i + 1] < 0) {
            x[i + 1] = 0;
            p[i] += (x[i] - p[i]) * C.friction;
            p[i + 2] += (x[i + 2] - p[i + 2]) * C.friction;
            hit++;
          }
        }
        if (hit) b.grounded = 1;
      }
      for (const a of awake) {
        const ix = Math.floor(a.c[0] / size) + 2048,
          iz = Math.floor(a.c[2] / size) + 2048;
        for (let gx = ix - 1; gx <= ix + 1; gx++) {
          for (let gz = iz - 1; gz <= iz + 1; gz++) {
            const list = grid.get(gx * 4096 + gz);
            if (!list) continue;
            for (const b of list) {
              if (b === a) continue;
              // Against its sisters, and against whatever is standing. Not against another burst's
              // daughters in the air with it: then every burst is a thing of its own, the same each
              // time round, however the others fall.
              if (b.asleep || b.prod) lean(a, b, this.widest, this.squat, 1);
              // (one being carried to its place is taken there, but grows into it as it is carried: taken there
              // whole at once, it shoved whatever was beside it out of the way in one step)
              else if (b.easing) lean(a, b, this.widest, this.squat, 0.6 + 0.4 * smooth(0, C.easeFor, (this.step - b.easedAt) * H));
              else if (
                ((a.litter === b.litter && !(C.apart && a.ghost && this.seams < C.labFor - C.labTouch) && (this.step - a.born) * H >= C.apartFor && (this.step - a.born) * H < (C.putt ? C.sisterFor : Infinity)) ||
                  (C.free && C.mingle)) &&
                a.id < b.id &&
                !a.prod &&
                !b.prod
              )
                press(a, b, false);
            }
            // (free: whatever is moving meets whatever else is, so nothing has a place kept for it)
            if (C.free) continue;
            const coming = spots.get(gx * 4096 + gz);
            if (coming)
              for (const b of coming) {
                if (b.R < a.R * 1.5) continue;
                const there = smooth(0, 1, (this.step - b.born) * H);
                if (there > 0.05) lean(a, b, this.widest, this.squat, there);
              }
          }
        }
      }
    }

    // (putt) sisters keeping softly off each other
    if (C.putt) {
      const P = (this.K * (this.K - 1)) / 2,
        from = Math.round(C.gapFrom / H);
      const byLitter = new Map<number, Cell[]>();
      for (const b of awake) {
        if (!b.litter || b.prod) continue;
        const l = byLitter.get(b.litter);
        if (l) l.push(b);
        else byLitter.set(b.litter, [b]);
      }
      for (const list of byLitter.values())
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i],
              b = list[j];
            const dx = b.c[0] - a.c[0],
              dy = b.c[1] - a.c[1],
              dz = b.c[2] - a.c[2];
            const d = Math.hypot(dx, dy, dz),
              R = (a.R + b.R) / 2;
            const over = (C.sisterReach * (a.R + b.R) - d) / R;
            if (over <= 0 || d < 1e-9) continue;
            if (a.ghost) {
              // (a try: noted, not felt)
              if (this.step - a.born < from) continue;
              const lo = Math.min(a.slot, b.slot),
                hi = Math.max(a.slot, b.slot);
              const at = (a.from * this.T + a.ghost - 1) * P + (lo * (2 * this.K - lo - 1)) / 2 + (hi - lo - 1);
              if (over > this.close[at]) this.close[at] = over;
              continue;
            }
            if (C.sisterSoft <= 0) continue;
            const nx = dx / d,
              ny = dy / d,
              nz = dz / d;
            // how fast they come together, in radii a second
            const vn = ((b.c[0] - b.was[0] - (a.c[0] - a.was[0])) * nx + (b.c[1] - b.was[1] - (a.c[1] - a.was[1])) * ny + (b.c[2] - b.was[2] - (a.c[2] - a.was[2])) * nz) / H / R;
            const push = C.sisterSoft * over * over - C.sisterCalm * Math.min(1, over * 4) * vn;
            if (push <= 0) continue;
            // (each by as much as the other: the smaller is moved more, by the sizes' cubes)
            const ma = a.R ** 3,
              mb = b.R ** 3;
            const ga = (push * R * H * H * mb) / (ma + mb),
              gb = (push * R * H * H * ma) / (ma + mb);
            for (let k = 0; k < a.n * 3; k += 3) {
              a.x[k] -= nx * ga;
              a.x[k + 1] -= ny * ga;
              a.x[k + 2] -= nz * ga;
            }
            for (let k = 0; k < b.n * 3; k += 3) {
              b.x[k] += nx * gb;
              b.x[k + 1] += ny * gb;
              b.x[k + 2] += nz * gb;
            }
          }
    }
    // litters whose time to be given places has come
    const due = Math.round(C.fallFor / H);
    for (const b of awake) {
      if (b.placed || this.step - b.born < due) continue;
      this.share(awake.filter((o) => o.litter === b.litter && !o.placed));
    }
    // pushes from bursts near by, given over a few moments
    const give = Math.min(1, H / Math.max(H, C.blastFor));
    for (const b of awake) {
      const v = b.shove;
      if (v[0] === 0 && v[1] === 0 && v[2] === 0) continue;
      b.kick(v[0] * give, v[1] * give, v[2] * give);
      for (let r = 0; r < 3; r++) v[r] = Math.abs(v[r]) < 1e-6 * b.R ? 0 : v[r] * (1 - give);
    }
    const aim = [0, 0];
    let gone = false;
    for (const b of awake) {
      invert(b.G, b.Gi);
      if (b.prod) continue;
      const age = (this.step - b.born) * H;
      // Once it has a place it is pulled to it as by a spring, its sliding damped as it goes. Not
      // before: until then it falls and rolls as it will.
      // (free: none is)
      const on = b.placed && !C.free ? smooth(C.fallFor, C.fallFor + C.homeIn, age) : 0;
      const mx = b.c[0] - b.was[0],
        mz = b.c[2] - b.was[2];
      const slide = Math.hypot(mx, mz) / H / b.R;
      let blocked = false;
      if (C.putt && b.ghost) {
        // (a rehearsal: left to itself)
      } else if (C.putt && b.placed && b.grounded) {
        if (this.step - b.aimAt >= 4) {
          this.clear(b.R, b.tx, b.tz, aim);
          b.aimX = aim[0];
          b.aimZ = aim[1];
          b.aimAt = this.step;
        }
        blocked = Math.hypot(b.aimX - b.tx, b.aimZ - b.tz) > 0.02 * b.R;
        const ex = b.aimX - b.c[0],
          ez = b.aimZ - b.c[2];
        const dist = Math.hypot(ex, ez);
        if (dist > 1e-6 * b.R) {
          const ux = ex / dist,
            uz = ez / dist;
          const vx = mx / H,
            vz = mz / H;
          // how fast she goes towards it, and aside
          const along = vx * ux + vz * uz;
          const sx = vx - along * ux,
            sz = vz - along * uz;
          // Rolling dies away by itself at `roll`: she stops just there if she goes towards it at roll
          // times how far it is. Faster, she is slowed; slower, helped a little; aside, turned in.
          const want = C.roll * dist;
          let a = (want - along) * C.steer;
          a = Math.max(-C.brake * b.R, Math.min(C.drive * b.R, a));
          // (once she has all but stopped near it, nothing: the easing takes the rest)
          const ramp = smooth(0.02, 0.12, dist / b.R);
          let lx = -sx * C.steer,
            lz = -sz * C.steer;
          const l = Math.hypot(lx, lz),
            most = C.curve * b.R;
          if (l > most) {
            lx *= most / l;
            lz *= most / l;
          }
          const gx = (a * ux + lx) * ramp * H * H,
            gz = (a * uz + lz) * ramp * H * H;
          b.helped += Math.hypot(gx, gz) / (H * H * b.R);
          const { x } = b;
          for (let i = 0; i < b.n * 3; i += 3) {
            x[i] += gx;
            x[i + 2] += gz;
          }
        }
      } else if (on > 0 && !C.putt) {
        // (looked for every fourth step: what is standing does not change faster than that matters)
        if (this.step - b.aimAt >= 4) {
          this.clear(b.R, b.tx, b.tz, aim);
          b.aimX = aim[0];
          b.aimZ = aim[1];
          b.aimAt = this.step;
        }
        aim[0] = b.aimX;
        aim[1] = b.aimZ;
        blocked = Math.hypot(aim[0] - b.tx, aim[1] - b.tz) > 0.02 * b.R;
        const sx = (aim[0] - b.c[0]) * C.pull * H * H * on - mx * C.calm * H * on,
          sz = (aim[1] - b.c[2]) * C.pull * H * H * on - mz * C.calm * H * on;
        const { x } = b;
        for (let i = 0; i < b.n * 3; i += 3) {
          x[i] += sx;
          x[i + 2] += sz;
        }
      }
      // On the floor it turns just as far as it goes, about the level line square to the way it is
      // going: whatever turning it has beyond that, or short of it, is taken up. So it never turns
      // where it stands, and never slides without turning.
      if (b.grounded && C.grip > 0) {
        const q = b.q,
          w = b.qWas;
        // how it turned over this step: q times the inverse of what it was, twice the vector part
        let rx = 2 * (w[3] * q[0] - q[3] * w[0] - (q[1] * w[2] - q[2] * w[1])),
          ry = 2 * (w[3] * q[1] - q[3] * w[1] - (q[2] * w[0] - q[0] * w[2])),
          rz = 2 * (w[3] * q[2] - q[3] * w[2] - (q[0] * w[1] - q[1] * w[0]));
        if (q[0] * w[0] + q[1] * w[1] + q[2] * w[2] + q[3] * w[3] < 0) {
          rx = -rx;
          ry = -ry;
          rz = -rz;
        }
        const up = Math.max(0.3 * b.R, b.c[1]);
        const ex = ((b.c[2] - b.was[2]) / up - rx) * C.grip,
          ey = -ry * C.grip,
          ez = (-(b.c[0] - b.was[0]) / up - rz) * C.grip;
        const { x } = b;
        const cx = b.c[0],
          cy = b.c[1],
          cz = b.c[2];
        for (let i = 0; i < b.n * 3; i += 3) {
          const ax = x[i] - cx,
            ay = x[i + 1] - cy,
            az = x[i + 2] - cz;
          x[i] += ey * az - ez * ay;
          x[i + 1] += ez * ax - ex * az;
          x[i + 2] += ex * ay - ey * ax;
        }
      }
      // (putt: an unseen try is only watched until she stops, and then let go)
      if (b.ghost) {
        if ((age >= 1.2 && b.grounded && slide < 0.12) || age > 5) {
          this.tried(b, b.c[0], b.c[2]);
          b.alive = false;
          b.freeAt = this.step;
          b.stirred++;
          gone = true;
        }
        continue;
      }
      // Once it has all but stopped where it should be, what little is left between how it is and how
      // it will stand is taken out: from here it is no longer worked out as a body, but carried from the
      // shape it has (kept in `p`) to the standing one, slow at both ends, and then left.
      const off = Math.hypot(b.tx - b.c[0], b.tz - b.c[2]) / b.R;
      // (not while something is standing on its place: it waits beside it)
      // (free: and one whose turn to burst is coming is taken to stand in time for it, or it would burst
      // whenever it happened to stop, a different moment each time round)
      const late = C.free ? age > C.sleepAt + C.freeLate || (b.due >= 0 && this.step >= b.due - fuse - Math.round((C.easeFor + 0.2) / H)) : age > C.sleepAt + 1.6 && !blocked;
      // (free: whether it has all but stopped is a line it crosses one step or the next, and what leans on
      // it as it settles goes by when it did: from one generation to the next that can swing back and
      // forth for good. So when each place's daughter came to stand is learnt with the rest, and kept)
      const kept = C.free && b.litter > 0 && this.seams >= C.freeTeach + C.learn + C.placeFor && this.stopAfter[b.idx] >= 0;
      const now = kept ? this.step - b.born >= this.stopAfter[b.idx] || late : age >= C.sleepAt && !blocked && (((off < 0.06 || C.free) && slide < 0.12) || late);
      if (now) {
        if (C.free && b.litter && !kept) this.stopAfter[b.idx] = this.step - b.born;
        if (C.free && b.litter && b.placed) {
          // (free: where she came to rest, for the rehearsal; and if her colony will never burst, that is
          // her place, until some generations after the pushes are kept; then the place is kept, and what
          // little she is off it is taken out as she settles)
          const at = b.from * this.K + b.slot;
          this.stops[at * 2] = b.c[0] / b.sigma;
          this.stops[at * 2 + 1] = b.c[2] / b.sigma;
          // (counted by the place itself: a litter that leaves the view before it has all stopped is never
          // judged, and a place waiting on that would go on moving for ever, and the crowd never come round the same)
          if (!this.bursts[b.idx] && this.seams < C.freeTeach + C.learn + C.placeFor) {
            this.moved[b.idx]++;
            b.tx = b.c[0];
            b.tz = b.c[2];
            this.px[b.idx] = b.tx / b.sigma;
            this.pz[b.idx] = b.tz / b.sigma;
          }
        }
        // It stands the way up it has come to: its place takes that as the way up to stand (nothing
        // turns it now). Its daughters keep their seats in the world: where they sit in it is worked
        // out again for the new way up. Once the crowd comes round the same, so does this, exactly.
        if (b.litter && b.fixed && this.learnt[b.idx] < C.learn) {
          this.learnt[b.idx]++;
          this.standAs(b);
        }
        this.pose(b);
        const { x, p } = b;
        const at = [0, 0, 0];
        let most = 0;
        for (let i = 0; i < b.n * 3; i += 3) {
          this.stand(b, i, at);
          for (let r = 0; r < 3; r++) {
            p[i + r] = x[i + r];
            most = Math.max(most, Math.abs(at[r] - x[i + r]));
          }
        }
        if (this.easeTrace) {
          const q = b.q,
            t = b.lieQ;
          this.easeTrace.push([
            b.idx,
            (2 * Math.acos(Math.min(1, Math.abs(q[0] * t[0] + q[1] * t[1] + q[2] * t[2] + q[3] * t[3]))) * 180) / Math.PI,
            this.learnt[b.idx],
            b.fixed ? 1 : 0,
            late ? 1 : 0,
            off,
            (this.step - b.born) * H,
          ]);
        }
        this.tally.began++;
        this.tally.off += off;
        this.tally.slide += slide;
        this.tally.shape += most / b.R;
        if (late) this.tally.hurried++;
        b.easing = true;
        b.easedAt = this.step;
        b.shove.fill(0);
      }
      this.settle(b);
    }
    if (gone) this.live = this.live.filter((b) => b.alive);
    if (C.free) {
      // (by now every one of a litter has come to stand, or been taken to)
      const by = Math.round((C.sleepAt + C.freeLate + 0.05) / H);
      for (const b of this.live) {
        if (b.judged || this.step - b.born < by) continue;
        for (const o of this.live) if (o.litter === b.litter) o.judged = true;
        if (!b.fixed) this.judge(b.from);
      }
    }
    this.step++;
  }

  // Every body by its number, in the measure of the moment: two of these a period apart should be equal.
  snapshot() {
    const out = new Map<number, number[]>();
    // (two generations are about at once: the older is told apart by its size)
    for (const b of this.live) if (!b.ghost) out.set(b.idx + 100000 * Math.round(Math.log(b.sigma) / Math.log(this.s)), [b.c[0], b.c[1], b.c[2], b.q[0], b.q[1], b.q[2], b.q[3], b.R, b.asleep ? 1 : 0]);
    return out;
  }
}

// A soft body against one that is standing still: only the soft one gives. The standing one is taken
// as the rounded shape it is (a ball a little lower than wide, on the floor), and any point of the soft
// one inside it is put back on its surface, straight out from its middle. A flat wall between the two,
// which serves for two soft bodies of a size, would crush a small one tucked in under a big one's side.
function lean(a: Cell, b: Cell, wide: number, low: number, there: number) {
  // (one not yet standing is taken at its place, and smaller by as much as it is not yet there)
  const still = b.asleep || b.easing || !!b.prod;
  const bx = b.tx + (still ? b.ox : 0),
    by = b.R * low * there,
    bz = b.tz + (still ? b.oz : 0);
  const rw = b.R * wide * there,
    rh = b.R * low * there;
  const dx = a.c[0] - bx,
    dz = a.c[2] - bz;
  const reach = rw + a.R * 1.6,
    most = a.R * 0.35;
  if (dx * dx + dz * dz > reach * reach) return;
  const x = a.x;
  for (let i = 0; i < a.n * 3; i += 3) {
    const ux = (x[i] - bx) / rw,
      uy = (x[i + 1] - by) / rh,
      uz = (x[i + 2] - bz) / rw;
    const l2 = ux * ux + uy * uy + uz * uz;
    if (l2 >= 1 || l2 < 1e-12) continue;
    // Straight out from its middle; but below the middle that is downwards too, into the floor, and
    // between the two a point would have nowhere to go: there it is put out sideways instead (unless
    // it is so near the upright line that sideways would be a long way). Never far in one go.
    let px = x[i],
      py = x[i + 1],
      pz = x[i + 2];
    const flat = ux * ux + uz * uz;
    if (uy < 0 && flat > 0.3) {
      const k = Math.sqrt((1 - uy * uy) / flat);
      px = bx + ux * k * rw;
      pz = bz + uz * k * rw;
    } else {
      const k = 1 / Math.sqrt(l2);
      px = bx + ux * k * rw;
      py = by + uy * k * rh;
      pz = bz + uz * k * rw;
    }
    const mx = px - x[i],
      my = py - x[i + 1],
      mz = pz - x[i + 2];
    const m = Math.sqrt(mx * mx + my * my + mz * mz);
    const k = m > most ? most / m : 1;
    x[i] += mx * k;
    x[i + 1] += my * k;
    x[i + 2] += mz * k;
  }
}
