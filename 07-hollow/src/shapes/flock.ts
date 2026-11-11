// The choreography: shapes hold a figure, a pendulum ball swings through and knocks them loose, and
// they flow around it and settle straight into the next figure. Figures are hollow solids that aren't
// there (a cube, a tetrahedron, a torus, Suzanne) or a loose cloud, taken in turn from a sequence, one
// per pass.
//
// The ball passes once each way per swing, so a sequence of K figures is K passes and K / 2 swings.
// Each shape follows a target that is written down (a blend of its places in the figures), pulled by a
// damped spring; the ball really hits them. Everything that drives the springs repeats each loop and
// the springs forget, so the motion repeats exactly.
import { Quaternion, Vector3 } from "three";
import { cube, gaussian, KINDS, lieOn, measure, mesh, random, relax, spread, tetrahedron, torus, type Kind, type Surface } from "./formation";

export const TAU = Math.PI * 2;

export type Figure = "cube" | "tetra" | "torus" | "suzanne" | "cloud";
export type Solid = Exclude<Figure, "cloud">;
export const SOLIDS: Solid[] = ["cube", "tetra", "torus", "suzanne"];
export const SEQUENCES: Record<string, Figure[]> = {
  "cube, tetrahedron, torus, suzanne": ["cube", "tetra", "torus", "suzanne"],
  "cube, tetrahedron": ["cube", "tetra"],
  "torus, suzanne": ["torus", "suzanne"],
  "cube, suzanne, tetrahedron, suzanne": ["cube", "suzanne", "tetra", "suzanne"],
  "cloud, cube, cloud, tetrahedron": ["cloud", "cube", "cloud", "tetra"],
  "cube, tetrahedron, cloud, tetrahedron": ["cube", "tetra", "cloud", "tetra"],
};

export const choreo = {
  sequence: "cube, tetrahedron, torus, suzanne",
  count: 850,
  smallest: 0.022,
  largest: 0.09,
  /** how sizes spread: higher keeps most of them small */
  skew: 2.6,
  /** shares of each kind */
  mix: { sphere: 0.44, cube: 0.36, tetra: 0.2 } as Record<Kind, number>,
  /** half the cube's side */
  cube: 0.78,
  /** how wide the cloud spreads */
  cloud: 0.8,
  /** how far the figures turn while they hold */
  spin: 0.22,
  /** how far Suzanne looks away from the camera, in radians, and her surface against the cube's */
  suzanneTurn: 0.12,
  suzanneSize: 0.89,
  /** how far shapes wander off a straight line when they move between figures */
  swirl: 0.25,
  /**
   * whole turns a shape makes round the left-right axis on its way to its next place, a whirlwind along
   * the ball's path; whole, so it lands where it was going. 0 flies straight
   */
  whirl: 1,
  /** how far out from that axis the whirl throws shapes on the way, against their distance from it */
  flare: 0.35,
  seed: 7,
};

export const swing = {
  /** seconds between hits: the ball passes through once each way per swing */
  every: 8,
  radius: 1.43,
  /** pendulum length, and how far it swings, in radians */
  length: 7.5,
  amplitude: 0.95,
};

export const springs = {
  stiffness: 26,
  damping: 8,
  /** how much a shape bounces off the ball */
  bounce: 0.35,
};

/** seconds between passes of the ball: half a swing */
const pass = () => swing.every;
/**
 * seconds a shape takes to move to its next place, and how early it starts before the ball reaches it;
 * quicker when the hits come quicker, so each move is done well before the next pass
 */
const moveSeconds = () => Math.min(2.1, 0.45 * pass());
const LEAD = 0.2;

let figures: Figure[] = SEQUENCES[choreo.sequence];
export const sequence = () => figures;
export const loopSeconds = () => figures.length * pass();

const smoother = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const fract = (x: number) => x - Math.floor(x);

/** where pass j falls in the loop; it breaks figure j and makes figure j + 1. Even passes go left to right */
const passAt = (j: number) => (j + 0.5) / figures.length;

/** the pendulum's angle, positive to the left; K / 2 swings a loop */
const angle = (u: number) => swing.amplitude * Math.cos(Math.PI * figures.length * u);
export function ball(u: number, out = new Vector3()) {
  const a = angle(u);
  return out.set(-swing.length * Math.sin(a), swing.length * (1 - Math.cos(a)), 0);
}
export const pivot = () => new Vector3(0, swing.length, 0);
/** the share of a loop the ball takes to cross one unit near the bottom */
const crossing = () => 1 / (Math.PI * figures.length * swing.length * swing.amplitude);

const up = new Vector3(0, 1, 0);
const tilts: Record<Figure, Quaternion> = {
  // turned to show three faces, tipped towards the camera; turning about the vertical keeps that
  cube: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.45).multiply(new Quaternion().setFromAxisAngle(up, 0.6)),
  // stood on a face, corner up, tipped a little towards the camera
  tetra: new Quaternion()
    .setFromAxisAngle(new Vector3(1, 0, 0), 0.22)
    .multiply(new Quaternion().setFromUnitVectors(new Vector3(1, 1, 1).normalize(), up)),
  // the ring turned towards the camera, so the hole shows, and a little to one side
  torus: new Quaternion().setFromAxisAngle(up, 0.35).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.15)),
  // set from choreo.suzanneTurn when used
  suzanne: new Quaternion(),
  cloud: new Quaternion(),
};
/** Suzanne nearly facing the camera: from the front her ears and chin make the outline, from the side she's a lump */
const tiltOf = (f: Figure) =>
  f !== "suzanne" ? tilts[f] : tilts.suzanne.setFromAxisAngle(up, -choreo.suzanneTurn).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.12));

/** Suzanne's mesh, handed over by the page once it has loaded */
let monkey: { position: ArrayLike<number>; index: ArrayLike<number>; area: number } | null = null;
export function setSuzanne(position: ArrayLike<number>, index: ArrayLike<number>) {
  let area = 0;
  const v = (i: number) => new Vector3(position[i * 3], position[i * 3 + 1], position[i * 3 + 2]);
  for (let t = 0; t < index.length; t += 3) {
    const a = v(index[t]);
    area += v(index[t + 1]).sub(a).cross(v(index[t + 2]).sub(a)).length() / 2;
  }
  monkey = { position, index, area };
}

/** seconds since the pass that made figure k */
const sinceMade = (k: number, u: number) => fract(u - passAt((k + figures.length - 1) % figures.length)) * loopSeconds();

/**
 * How figure k is turned. It turns one way while it holds, a swing rather than a spin: sin(pi t / pass)
 * repeats every two passes, and a loop is an even number of them, so the turn closes with the loop.
 * Figures alternate direction.
 */
export function figureTurn(k: number, u: number, out = new Quaternion()) {
  const f = figures[k];
  if (f === "cloud") return out.identity();
  const t = sinceMade(k, u);
  // Suzanne only reads from the front, so she looks around less
  const sign = (k % 2 ? -1.3 : 1) * (f === "suzanne" ? 0.35 : 1);
  return out.setFromAxisAngle(up, sign * choreo.spin * Math.PI * Math.sin(Math.PI * (t / pass() - 0.5))).multiply(tiltOf(f));
}

/** each solid's size, so every shell holds about as much as the cube's; Suzanne a little more, for her features */
const cubeArea = () => 24 * choreo.cube * choreo.cube;
export const sizes = {
  /** circumradius */
  tetra: () => Math.sqrt(cubeArea() / Math.sqrt(3)) * (Math.sqrt(6) / 4) * 0.97,
  /** ring radius; the tube is 0.4 of it */
  torus: () => Math.sqrt(cubeArea() / (4 * Math.PI * Math.PI * 0.4)),
  /** scale of the mesh */
  suzanne: () => Math.sqrt((cubeArea() * choreo.suzanneSize) / (monkey?.area ?? 1)),
};
export const tetraRadius = sizes.tetra;

function surfaceOf(f: Solid): Surface {
  if (f === "cube") return cube(choreo.cube);
  if (f === "tetra") return tetrahedron(sizes.tetra());
  if (f === "torus") return torus(sizes.torus(), sizes.torus() * 0.4);
  if (!monkey) throw new Error("Suzanne hasn't loaded");
  return mesh(monkey.position, monkey.index, sizes.suzanne());
}

/**
 * How much of each missing solid stands in the scene, 0 to 1: it grows once the shapes have settled on
 * it, and shrinks away while the ball goes through and scatters them. The ball itself is never hidden.
 */
export function presence(u: number) {
  const out = Object.fromEntries(SOLIDS.map((f) => [f, { amount: 0, turn: new Quaternion() }])) as Record<Solid, { amount: number; turn: Quaternion }>;
  figures.forEach((f, k) => {
    if (f === "cloud") return;
    const t = sinceMade(k, u);
    const grown = Math.min(2.7, 0.6 * pass());
    const p = smoother(grown, grown + 0.4, t) * (1 - smoother(pass() - 0.24, pass() + 0.32, t));
    if (p > out[f].amount) {
      out[f].amount = p;
      figureTurn(k, u, out[f].turn);
    }
  });
  return out;
}

export interface Place {
  /** in the figure's own space, or the cloud's resting place */
  p: Vector3;
  /** how the shape lies there, in the figure's own space */
  turn: Quaternion;
  /** in a cloud, the world turns it glides between: as it left the figure before, as it lands on the next */
  from?: Quaternion;
  to?: Quaternion;
}

export interface Shape {
  kind: Kind;
  size: number;
  bound: number;
  /** one per figure in the sequence */
  places: Place[];
  drift: Vector3[];
  driftPhase: Vector3[];
  tumbleAxis: Vector3;
  tumbleTurns: number;
  tumblePhase: number;
  /** when each pass reaches this shape, as a share of the loop */
  starts: number[];
  /**
   * for each move, +1 or -1: which way round it turns, the short way as it stood at the pass. Fixed, so
   * the turn can't jump if the short way changes sides while both figures turn.
   */
  ways: number[];
  swirls: Vector3[];
}

export function build(): Shape[] {
  figures = SEQUENCES[choreo.sequence];
  const K = figures.length;
  const rand = random(choreo.seed);
  const n = choreo.count;
  const total = KINDS.reduce((a, k) => a + choreo.mix[k], 0);
  const kinds = Array.from({ length: n }, () => {
    let r = rand() * total;
    for (const k of KINDS) if ((r -= choreo.mix[k]) < 0) return k;
    return KINDS[0];
  });
  const radii = kinds.map(() => choreo.smallest + (choreo.largest - choreo.smallest) * Math.pow(rand(), choreo.skew));

  // shells from the same directions, so each shape has nearby places on every figure and a change of
  // figure reads as one movement
  const dirs = kinds.map(() => new Vector3(gaussian(rand), gaussian(rand), gaussian(rand)).normalize());
  const feet = kinds.map((k, i) => radii[i] * measure.footprint[k]);
  const shells: Partial<Record<Solid, ReturnType<typeof relax>>> = {};
  for (const f of new Set(figures)) {
    if (f === "cloud") continue;
    const surface = surfaceOf(f);
    shells[f] = relax(surface, spread(surface, dirs, rand), feet);
  }
  // every cloud in the sequence a different one: a few loose clumps and some strays
  const clouds = figures.map(() => {
    const clumps = Array.from({ length: 5 }, () => new Vector3((rand() - 0.5) * 3.2, (rand() - 0.5) * 3.4, (rand() - 0.5) * 1.6).multiplyScalar(choreo.cloud));
    return kinds.map(() => {
      if (rand() < 0.18) return new Vector3((rand() - 0.5) * 4.6, (rand() - 0.5) * 4.6, (rand() - 0.5) * 2.5).multiplyScalar(choreo.cloud);
      const c = clumps[Math.floor(rand() * clumps.length)];
      return c.clone().add(new Vector3(gaussian(rand), gaussian(rand), gaussian(rand)).multiplyScalar(0.42 * choreo.cloud));
    });
  });

  const k = crossing();
  const world = new Quaternion(), candidate = new Quaternion(), turned = new Vector3();
  return kinds.map((kind, i) => {
    const size = radii[i];
    const lift = size * measure.contact[kind];
    // Places in order. Each figure's twist is the one that turns least from the place before, as the
    // pass between them sees it, so going from one to the next is a short turn and slerp can't flip.
    // Clouds come after, from their neighbours.
    const places: Place[] = [];
    const lies: (Quaternion | null)[] = []; // how the shape lies in each figure at the pass that breaks it, in the world
    let before: Quaternion | null = null; // the same for the last figure that wasn't a cloud
    figures.forEach((f, j) => {
      const at = passAt((j + K - 1) % K); // the pass that makes figure j
      if (f === "cloud") {
        places.push({ p: clouds[j][i], turn: new Quaternion() });
        lies.push(null);
        return;
      }
      const spot = shells[f]![i];
      const square = kind === "cube" && f === "cube";
      const options = square ? [0, 1, 2, 3].map((a) => (a * Math.PI) / 2 + (rand() - 0.5) * 0.1) : Array.from({ length: 48 }, (_, a) => (a / 48) * TAU);
      figureTurn(j, at, world);
      let best = options[Math.floor(rand() * options.length)], closest = -1;
      if (before) {
        for (const twist of options) {
          const d = Math.abs(candidate.copy(world).multiply(lieOn(kind, spot.n, twist)).dot(before));
          if (d > closest) (closest = d), (best = twist);
        }
      }
      const turn = lieOn(kind, spot.n, best);
      places.push({ p: spot.p.clone().addScaledVector(spot.n, lift), turn });
      before = figureTurn(j, passAt(j), new Quaternion()).multiply(turn);
      lies.push(before);
    });
    figures.forEach((f, j) => {
      if (f !== "cloud") return;
      const landing = figureTurn((j + 1) % K, passAt(j), new Quaternion()).multiply(places[(j + 1) % K].turn);
      places[j].from = lies[(j + K - 1) % K] ?? landing;
      places[j].to = landing;
    });

    // each shape changes figure as the ball reaches it, so the change sweeps along behind the ball;
    // kept clear of the loop's ends, where a move would jump
    const move = moveSeconds() / loopSeconds();
    const starts = figures.map((_, j) => {
      figureTurn(j, passAt(j), world);
      turned.copy(places[j].p);
      if (figures[j] !== "cloud") turned.applyQuaternion(world);
      const way = j % 2 ? -1 : 1;
      return Math.min(Math.max(passAt(j) + way * turned.x * k - LEAD / loopSeconds(), 0.005), 0.995 - move);
    });

    const shape: Shape = {
      kind,
      size,
      bound: size * measure.bound[kind],
      places,
      drift: [1, 2].map((h) => new Vector3(gaussian(rand), gaussian(rand), gaussian(rand)).multiplyScalar(0.12 / h)),
      driftPhase: [1, 2].map(() => new Vector3(rand(), rand(), rand()).multiplyScalar(TAU)),
      tumbleAxis: new Vector3(gaussian(rand), gaussian(rand), gaussian(rand)).normalize(),
      tumbleTurns: (rand() < 0.5 ? -1 : 1) * (1 + Math.floor(rand() * 2)),
      tumblePhase: (rand() - 0.5) * Math.PI,
      starts,
      ways: [],
      swirls: figures.map(() => new Vector3(gaussian(rand), gaussian(rand), gaussian(rand)).multiplyScalar(choreo.swirl * 0.5)),
    };
    // which way round each move turns: the short way as it stands at the pass, kept for the whole move
    const a = new Quaternion(), b = new Quaternion();
    shape.ways = figures.map((_, m) => {
      lying(shape, m, passAt(m), a);
      lying(shape, (m + 1) % K, passAt(m), b);
      return a.dot(b) < 0 ? -1 : 1;
    });
    return shape;
  });
}

const tmpA = new Vector3(), tmpB = new Vector3();
const qa = new Quaternion(), qb = new Quaternion();
const weights: number[] = [];
const members: number[] = [];

/** how far each pass's move has gone for this shape */
function progress(s: Shape, u: number) {
  const move = moveSeconds() / loopSeconds();
  for (let j = 0; j < figures.length; j++) weights[j] = smoother(s.starts[j], s.starts[j] + move, u);
  return weights;
}

/** a shape's place in figure k, in the world */
function placeIn(s: Shape, k: number, u: number, out: Vector3) {
  out.copy(s.places[k].p);
  if (figures[k] !== "cloud") return out.applyQuaternion(figureTurn(k, u, qa));
  for (let h = 0; h < 2; h++) {
    const d = s.drift[h], p = s.driftPhase[h];
    const w = TAU * (h + 1) * u;
    out.x += d.x * Math.sin(w + p.x);
    out.y += d.y * Math.sin(w + p.y);
    out.z += d.z * Math.sin(w + p.z);
  }
  return out;
}

/**
 * Where a shape is meant to be: in figure 0, then each pass blends it on to the next figure. Every
 * move happens inside the loop, so at its end the blend has come round to figure 0 again.
 */
export function target(s: Shape, u: number, out: Vector3) {
  const w = progress(s, u);
  const K = figures.length;
  placeIn(s, 0, u, out);
  for (let j = 0; j < K; j++) {
    if (w[j] <= 0) continue;
    whirlTo(out, placeIn(s, (j + 1) % K, u, tmpB), w[j], j % 2 ? -1 : 1);
    out.addScaledVector(s.swirls[j], 4 * w[j] * (1 - w[j]));
  }
  return out;
}

/** the turn round the left-right axis a move has made by w, the way the ball went on that pass */
const whirled = (w: number, way: number) => way * TAU * Math.round(choreo.whirl) * w;

/**
 * From a towards b, w of the way, in polar terms about the left-right axis: across it as a straight
 * line, round it whole turns, and out from it as far as the ends are, flaring on the way. The turns are
 * whole and added to a plain blend of the ends, so there's no angle to pick between a and b, nothing
 * that could pick the other way round mid flight, and at w = 1 it lands on b exactly.
 */
function whirlTo(a: Vector3, b: Vector3, w: number, way: number) {
  const ra = Math.hypot(a.y, a.z), rb = Math.hypot(b.y, b.z);
  a.lerp(b, w);
  // the blend cuts the corner where the ends sit round the axis from each other; push it back out to
  // the ends' distance, but only where it's well off the axis, so it can't jump through it
  const r = Math.hypot(a.y, a.z);
  const want = (ra + (rb - ra) * w) * (1 + choreo.flare * 4 * w * (1 - w));
  const sure = smoother(0, 0.5, r / Math.max(want, 1e-6));
  const k = r > 1e-6 ? 1 + (want / r - 1) * sure : 1;
  const angle = whirled(w, way);
  const c = Math.cos(angle), n = Math.sin(angle);
  const y = a.y * k, z = a.z * k;
  a.y = y * c - z * n;
  a.z = y * n + z * c;
  return a;
}

/** how a shape lies in figure k at a point of the loop, in the world */
function lying(s: Shape, k: number, u: number, q: Quaternion) {
  const K = figures.length;
  const place = s.places[k];
  if (place.from && place.to) {
    // two fixed ends, so this glide can't flip
    const t = (fract(u - passAt((k + K - 1) % K) + 0.25) - 0.25) * loopSeconds();
    return q.copy(place.from).slerp(place.to, smoother(0.2 * pass(), pass(), t));
  }
  return q.copy(figureTurn(k, u, qa)).multiply(place.turn);
}

/**
 * Slerp from a to b the way b's sign says, never re-picking the short way as three's slerp does. Both
 * ends turn as the figures do, so the short way can switch sides mid move; a way fixed at the pass can't.
 */
function slerpAlong(a: Quaternion, b: Quaternion, t: number) {
  const cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let ka = 1 - t, kb = t;
  if (Math.abs(cos) < 0.9995) {
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    const sin = Math.sin(angle);
    ka = Math.sin((1 - t) * angle) / sin;
    kb = Math.sin(t * angle) / sin;
  }
  return a.set(a.x * ka + b.x * kb, a.y * ka + b.y * kb, a.z * ka + b.z * kb, a.w * ka + b.w * kb).normalize();
}

/**
 * Which way a shape faces: flat on a face in a figure, tumbling in a cloud. Between figures it slerps,
 * a short turn by construction; the tumble is an angle about its own axis that grows while the shape
 * is in a cloud and unwinds as it leaves, so it can't jump.
 */
export function facing(s: Shape, u: number, out: Quaternion) {
  const w = progress(s, u);
  const K = figures.length;
  lying(s, 0, u, out);
  // how much the shape belongs to each figure, as the blend hands it on
  for (let k = 0; k < K; k++) members[k] = k ? 0 : 1;
  // which of a turn's two quaternions `out` holds: each move may have picked the other one
  let held = 1;
  for (let j = 0; j < K; j++) {
    if (w[j] <= 0) continue;
    const next = (j + 1) % K;
    held *= s.ways[j];
    lying(s, next, u, qb);
    if (held < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w);
    slerpAlong(out, qb, w[j]);
    for (let k = 0; k < K; k++) members[k] *= 1 - w[j];
    members[next] += w[j];
  }
  // in each cloud, a tumble counted from when that cloud was made, so it starts small and unwinds as
  // the shape leaves; the count runs on through the pass that makes the cloud, without a wrap
  let spin = 0;
  for (let k = 0; k < K; k++) {
    if (figures[k] !== "cloud" || members[k] <= 0) continue;
    const made = passAt((k + K - 1) % K);
    const t = (fract(u - made + 0.25) - 0.25) * loopSeconds();
    spin += members[k] * (s.tumblePhase + (TAU * s.tumbleTurns * t) / (2 * pass()));
  }
  if (spin) out.multiply(qb.setFromAxisAngle(s.tumbleAxis, spin));
  // carried round by the whirl, the way a leaf turns with the wind; whole turns, so it lands as it lay
  let round = 0;
  for (let j = 0; j < K; j++) if (w[j] > 0 && w[j] < 1) round += whirled(w[j], j % 2 ? -1 : 1);
  return round ? out.premultiply(qb.setFromAxisAngle(xAxis, round)) : out;
}
const xAxis = new Vector3(1, 0, 0);

/**
 * Shapes on springs towards their targets, knocked by the ball. Time runs on a fixed grid, so a loop
 * stepped through at any frame rate lands on the same moments.
 */
export class Flock {
  static DT = 1 / 120;
  /** steps of past positions kept, for the stretch: half a second */
  static HISTORY = 61;
  shapes: Shape[] = [];
  x = new Float32Array(0);
  v = new Float32Array(0);
  prev = new Float32Array(0);
  /** past positions, a ring indexed by step */
  past = new Float32Array(0);
  /** steps taken, on the grid: time is steps * DT */
  step = 0;

  get duration() {
    return loopSeconds();
  }

  reset(shapes: Shape[], time: number) {
    this.shapes = shapes;
    const n = shapes.length;
    this.x = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.past = new Float32Array(n * 3 * Flock.HISTORY);
    this.step = Math.round(time / Flock.DT);
    const u = this.u(this.step), before = this.u(this.step - 1);
    const p = new Vector3(), q = new Vector3();
    shapes.forEach((s, i) => {
      target(s, u, p);
      target(s, before, q);
      p.toArray(this.x, i * 3);
      q.toArray(this.prev, i * 3);
      p.sub(q).divideScalar(Flock.DT).toArray(this.v, i * 3);
    });
    // a settle is far longer than the history, so these first entries are gone before anyone asks
    for (let h = 0; h < Flock.HISTORY; h++) this.past.set(this.x, h * n * 3);
  }

  /** where shape i was `steps` steps ago, up to HISTORY - 1 */
  was(i: number, steps: number, out: Vector3) {
    const h = (((this.step - steps) % Flock.HISTORY) + Flock.HISTORY) % Flock.HISTORY;
    const o = (h * this.shapes.length + i) * 3;
    return out.set(this.past[o], this.past[o + 1], this.past[o + 2]);
  }

  u(step: number) {
    return fract((step * Flock.DT) / this.duration);
  }

  get time() {
    return this.step * Flock.DT;
  }

  advance() {
    const dt = Flock.DT;
    this.step++;
    const u = this.u(this.step);
    const S = ball(u, new Vector3());
    const Sv = ball(this.u(this.step + 1), new Vector3()).sub(ball(this.u(this.step - 1), new Vector3())).divideScalar(2 * dt);
    const { stiffness: k, damping: c, bounce } = springs;
    const R = swing.radius;
    const p = new Vector3(), d = new Vector3();
    const { x, v, prev } = this;
    this.shapes.forEach((s, i) => {
      const o = i * 3;
      target(s, u, p);
      // spring and damper both measured against the target, so a turning figure isn't left behind
      for (let a = 0; a < 3; a++) {
        const pa = p.getComponent(a);
        const acc = k * (pa - x[o + a]) + c * ((pa - prev[o + a]) / dt - v[o + a]);
        v[o + a] += acc * dt;
        x[o + a] += v[o + a] * dt;
        prev[o + a] = pa;
      }
      // the ball: out of it, and off it with some of its speed
      d.set(x[o] - S.x, x[o + 1] - S.y, x[o + 2] - S.z);
      const dist = d.length();
      const reach = R + s.bound;
      if (dist < reach) {
        d.divideScalar(dist || 1);
        x[o] = S.x + d.x * reach;
        x[o + 1] = S.y + d.y * reach;
        x[o + 2] = S.z + d.z * reach;
        const vn = (v[o] - Sv.x) * d.x + (v[o + 1] - Sv.y) * d.y + (v[o + 2] - Sv.z) * d.z;
        if (vn < 0) {
          v[o] -= (1 + bounce) * vn * d.x;
          v[o + 1] -= (1 + bounce) * vn * d.y;
          v[o + 2] -= (1 + bounce) * vn * d.z;
        }
      }
    });
    const h = ((this.step % Flock.HISTORY) + Flock.HISTORY) % Flock.HISTORY;
    this.past.set(x, h * x.length);
  }

  /** step up to a time, or start over a few seconds before it if it's far off */
  seek(time: number, settle = 6) {
    const want = Math.round(time / Flock.DT);
    if (want < this.step || want - this.step > 2 / Flock.DT || !this.shapes.length) this.reset(this.shapes, time - settle);
    while (this.step < want) this.advance();
  }
}
