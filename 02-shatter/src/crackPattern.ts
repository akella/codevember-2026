/**
 * The 2D fracture pattern of a pane hit by a bullet. No three.js in here.
 *
 * Built in the order the glass breaks: radial cracks run out from the impact
 * first, then concentric cracks link neighbouring radials and stop where they
 * hit one. So rings are chords laid per sector, which is what makes them step
 * at every radial instead of forming clean circles.
 */

export type P = [number, number];

export type Shard = {
  /** counter-clockwise outline */
  points: P[];
  center: P;
  area: number;
  /** distance from the impact: 0 there, 1 at the furthest corner */
  dist: number;
};

export type CrackOptions = {
  seed: number;
  halfWidth: number;
  halfHeight: number;
  impact: P;
  /** primary cracks leaving the impact */
  radials: number;
  /** 0: evenly spaced · 1: bunched up */
  radialJitter: number;
  /** how far radials bend at their kinks, as a share of the gap to a neighbour */
  kink: number;
  /** radius of the innermost ring */
  ringStart: number;
  /** ratio between consecutive rings at the impact... */
  ringGrowth: number;
  /** ...and at the far corner */
  ringGrowthOuter: number;
  /** how far a ring's chords stray from it, relative to its radius */
  ringJitter: number;
  /** chance a sector skips a ring at the far corner, which makes long shards */
  ringDrop: number;
  /** chance a wide sector forks at a ring */
  forks: number;
  /** chance a shard is cracked again, off the radial/ring structure */
  secondary: number;
  /** radius punched out by the bullet */
  hole: number;
};

export const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpP = (a: P, b: P, t: number): P => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function polygonArea(points: P[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

function polygonCenter(points: P[]): P {
  const area = polygonArea(points);
  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    const cross = x0 * y1 - x1 * y0;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }
  return [x / (6 * area), y / (6 * area)];
}

/** a crack as a polyline, parametrised by (roughly) its distance from the impact */
class Spoke {
  constructor(
    readonly radii: number[],
    readonly points: P[],
  ) {}

  at(r: number): P {
    const { radii, points } = this;
    if (r <= radii[0]) return points[0];
    for (let i = 1; i < radii.length; i++) {
      if (r <= radii[i]) {
        return lerpP(points[i - 1], points[i], (r - radii[i - 1]) / (radii[i] - radii[i - 1]));
      }
    }
    return points[points.length - 1];
  }

  /** kinks strictly between two radii, innermost first */
  between(r0: number, r1: number) {
    return this.points.filter((_, i) => this.radii[i] > r0 && this.radii[i] < r1);
  }
}

/** keep the half of a polygon inside x·axis <= limit, for a convex clip region */
function clipHalfPlane(points: P[], axis: 0 | 1, sign: 1 | -1, limit: number) {
  const out: P[] = [];
  const inside = (p: P) => sign * p[axis] <= limit;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) {
      out.push(lerpP(a, b, (limit - sign * a[axis]) / (sign * b[axis] - sign * a[axis])));
    }
  }
  return out;
}

/** split along a line through `origin`, using the nearest boundary hit each way */
function splitPolygon(points: P[], origin: P, direction: P): [P[], P[]] | null {
  let ahead = { s: Infinity, edge: -1 };
  let behind = { s: -Infinity, edge: -1 };
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const denom = direction[0] * ey - direction[1] * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const ox = a[0] - origin[0];
    const oy = a[1] - origin[1];
    const s = (ox * ey - oy * ex) / denom;
    const u = (ox * direction[1] - oy * direction[0]) / denom;
    if (u < 0 || u > 1) continue;
    if (s > 0 && s < ahead.s) ahead = { s, edge: i };
    if (s < 0 && s > behind.s) behind = { s, edge: i };
  }
  if (ahead.edge < 0 || behind.edge < 0 || ahead.edge === behind.edge) return null;

  const hit = (s: number): P => [origin[0] + direction[0] * s, origin[1] + direction[1] * s];
  const from = hit(ahead.s);
  const to = hit(behind.s);
  const walk = (start: number, end: number) => {
    const run: P[] = [];
    for (let i = (start + 1) % points.length; ; i = (i + 1) % points.length) {
      run.push(points[i]);
      if (i === end) return run;
    }
  };
  return [
    [from, ...walk(ahead.edge, behind.edge), to],
    [to, ...walk(behind.edge, ahead.edge), from],
  ];
}

/** where two segments properly cross, if they do */
function crossing(a: P, b: P, c: P, d: P): P | null {
  const side = (p: P, q: P, r: P) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const sideC = side(a, b, c);
  const sideD = side(a, b, d);
  if (sideC * sideD >= 0 || side(c, d, a) * side(c, d, b) >= 0) return null;
  return lerpP(c, d, sideC / (sideC - sideD));
}

function polylinesCross(a: P[], b: P[]) {
  return a.some(
    (p, i) => i > 0 && b.some((q, j) => j > 0 && crossing(a[i - 1], p, b[j - 1], q)),
  );
}

function isSimple(points: P[]) {
  const closed = [...points, points[0]];
  for (let i = 1; i < closed.length; i++) {
    for (let j = i + 2; j < closed.length; j++) {
      if (crossing(closed[i - 1], closed[i], closed[j - 1], closed[j])) return false;
    }
  }
  return true;
}

function withoutRepeats(points: P[]) {
  return points.filter((p, i) => dist(p, points[(i + 1) % points.length]) > 1e-7);
}

export function createCrackPattern(options: CrackOptions): Shard[] {
  const { impact, halfWidth, halfHeight } = options;
  const random = mulberry32(options.seed * 7919 + 1);
  const range = (a: number, b: number) => lerp(a, b, random());

  const corners: P[] = [
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
    [halfWidth, -halfHeight],
    [-halfWidth, -halfHeight],
  ];
  const reach = Math.max(...corners.map((corner) => dist(corner, impact)));
  /** 0 at the first ring, 1 at the far corner, on a log scale like the rings */
  const depth = (r: number) =>
    Math.min(1, Math.max(0, Math.log(r / options.ringStart) / Math.log(reach / options.ringStart)));

  const rings = [options.ringStart];
  while (rings[rings.length - 1] < reach) {
    const r = rings[rings.length - 1];
    const growth = lerp(options.ringGrowth, options.ringGrowthOuter, depth(r));
    rings.push(r * growth * range(0.93, 1.07));
  }
  const outerRadius = Math.max(rings[rings.length - 1], reach * 1.05);
  rings[rings.length - 1] = outerRadius;

  const polar = (r: number, angle: number): P => [
    impact[0] + Math.cos(angle) * r,
    impact[1] + Math.sin(angle) * r,
  ];

  // Radials: stratified angles, so jitter bunches them without ever swapping
  // order. Each bends within a band narrower than the gap to its neighbours.
  const count = options.radials;
  const spin = range(0, Math.PI * 2);
  const step = (Math.PI * 2) / count;
  const angles = Array.from(
    { length: count },
    (_, i) => spin + (i + range(-0.5, 0.5) * options.radialJitter) * step,
  );
  const spokes = angles.map((angle, i) => {
    const previous = i === 0 ? angles[count - 1] - Math.PI * 2 : angles[i - 1];
    const next = i === count - 1 ? angles[0] + Math.PI * 2 : angles[i + 1];
    const band = 0.45 * Math.min(angle - previous, next - angle);
    const radii = [options.ringStart];
    const points = [polar(options.ringStart, angle)];
    let bend = 0;
    let r = options.ringStart;
    while (r < outerRadius) {
      r = Math.min(r * range(1.7, 3.6), outerRadius);
      bend = Math.max(-band, Math.min(band, bend + range(-1, 1) * options.kink * band * 2));
      radii.push(r);
      points.push(polar(r, angle + bend));
    }
    return new Spoke(radii, points);
  });

  /**
   * A fork, starting at `start` on the chord that closes its sector. It is a
   * blend of the sector's two sides sampled at each of their kinks: between
   * samples all three are straight and keep their order, so it can't cross them.
   */
  const fork = (lo: Spoke, hi: Spoke, rStart: number, start: P, t: number) => {
    const settled = range(0.3, 0.7);
    const opened = rStart * range(1.5, 2.6);
    const radii = [...lo.radii, ...hi.radii, opened, outerRadius]
      .filter((r) => r > rStart)
      .sort((a, b) => a - b)
      .filter((r, i, all) => i === 0 || r > all[i - 1] * 1.001);
    const blend = (r: number) => lerp(t, settled, Math.min(1, (r - rStart) / (opened - rStart)));
    return new Spoke(
      [rStart, ...radii],
      [start, ...radii.map((r) => lerpP(lo.at(r), hi.at(r), blend(r)))],
    );
  };

  const cells: P[][] = [];

  /** walk a sector outwards from the chord (lo at rLo)-(hi at rHi), laying rings */
  const growSector = (lo: Spoke, hi: Spoke, ring: number, rLo: number, rHi: number) => {
    for (let i = ring; i < rings.length; i++) {
      const last = i === rings.length - 1;
      const r = rings[i];
      if (!last && random() < options.ringDrop * depth(r) ** 2) continue;

      const stray = () => (last ? 1 : 1 + range(-1, 1) * options.ringJitter);
      const nextLo = r * stray();
      const nextHi = r * stray();
      if (nextLo < rLo * 1.04 || nextHi < rHi * 1.04) continue;

      const cell = [
        lo.at(rLo),
        ...lo.between(rLo, nextLo),
        lo.at(nextLo),
        hi.at(nextHi),
        ...hi.between(rHi, nextHi).reverse(),
        hi.at(rHi),
      ];
      // in a thin sector a slanted chord can clip a kink: that ring just doesn't
      // form. The last cell has to stay, it mostly lies outside the pane anyway
      if (!last && !isSimple(cell)) continue;

      cells.push(cell);
      rLo = nextLo;
      rHi = nextHi;
      if (last) return;

      // wide sectors fork, from anywhere on the chord: its ends are forks off a
      // radial, the middle is a crack starting at a T-junction on the ring
      const width = dist(lo.at(rLo), hi.at(rHi)) / r;
      if (width > 0.3 && random() < options.forks * (width / 0.3)) {
        const t = random() < 0.4 ? (random() < 0.5 ? 0 : 1) : range(0.25, 0.75);
        const rFork = lerp(rLo, rHi, t);
        const start = lerpP(lo.at(rLo), hi.at(rHi), t);
        const child = fork(lo, hi, rFork, start, t);
        if (!polylinesCross(child.points, lo.points) && !polylinesCross(child.points, hi.points)) {
          growSector(lo, child, i + 1, rLo, rFork);
          growSector(child, hi, i + 1, rFork, rHi);
          return;
        }
      }
    }
  };

  for (let i = 0; i < count; i++) {
    growSector(spokes[i], spokes[(i + 1) % count], 1, options.ringStart, options.ringStart);
  }

  /** off-structure cracks: mostly along the rings, sometimes along the radials */
  const crack = (points: P[], level: number): P[][] => {
    if (level > 1 || random() > options.secondary / (level + 1)) return [points];
    const center = polygonCenter(points);
    const outward = Math.atan2(center[1] - impact[1], center[0] - impact[0]);
    const angle = outward + (random() < 0.7 ? Math.PI / 2 : 0) + range(-0.6, 0.6);
    const size = Math.sqrt(Math.abs(polygonArea(points)));
    const origin: P = [center[0] + range(-0.15, 0.15) * size, center[1] + range(-0.15, 0.15) * size];
    const halves = splitPolygon(points, origin, [Math.cos(angle), Math.sin(angle)]);
    if (!halves) return [points];
    const smallest = Math.min(...halves.map((half) => Math.abs(polygonArea(half))));
    if (smallest < 0.15 * size * size) return [points];
    return halves.flatMap((half) => crack(half, level + 1));
  };

  const shards: Shard[] = [];
  for (const cell of cells.flatMap((cell) => crack(withoutRepeats(cell), 0))) {
    let points = clipHalfPlane(cell, 0, 1, halfWidth);
    points = clipHalfPlane(points, 0, -1, halfWidth);
    points = clipHalfPlane(points, 1, 1, halfHeight);
    points = withoutRepeats(clipHalfPlane(points, 1, -1, halfHeight));
    if (points.length < 3 || !isSimple(points)) continue;

    const area = polygonArea(points);
    if (area < 1e-7) continue;
    const center = polygonCenter(points);
    const fromImpact = dist(center, impact);
    if (fromImpact < options.hole * range(0.75, 1.5)) continue;
    shards.push({ points, center, area, dist: fromImpact / reach });
  }
  return shards;
}
