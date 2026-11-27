// The sculpture: long sharp shards of glass, each a convex solid kept as the planes that bound it.
export type V3 = [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3) => mul(a, 1 / (len(a) || 1));
export const lerp = (a: V3, b: V3, t: number): V3 => add(a, mul(sub(b, a), t));

export const FACES = 8; // of a blade, at most
export const BLADES = 14;

export type Blade = { planes: [number, number, number, number][]; middle: V3; reach: number; axis: V3; points: V3[] };

// the planes round a handful of points: every three of them that have all the rest on one side
function hull(points: V3[], axis: V3): Blade {
  const planes: Blade["planes"] = [];
  const n = points.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const c = cross(sub(points[j], points[i]), sub(points[k], points[i]));
        if (len(c) < 1e-6) continue;
        let m = unit(c);
        let w = dot(m, points[i]);
        const side = points.map((p) => dot(m, p) - w);
        if (Math.max(...side) > 1e-5 && Math.min(...side) < -1e-5) continue;
        if (Math.max(...side) > 1e-5) {
          m = mul(m, -1);
          w = -w;
        }
        if (planes.some((q) => dot([q[0], q[1], q[2]], m) > 0.99999 && Math.abs(q[3] - w) < 1e-4)) continue;
        planes.push([...m, w]);
      }
  if (planes.length > FACES) throw new Error(`${planes.length} faces on a blade`);
  const middle = mul(points.reduce(add), 1 / n);
  return { planes, middle, reach: Math.max(...points.map((p) => len(sub(p, middle)))), axis, points };
}

// (a point as it stands in the drawing this is made after, a hundred to a unit, and how near)
export const at = (x: number, y: number, z: number): V3 => [(x - 560) / 100, (1130 - y) / 100, z];

export function sculpture(): Blade[] {
  const shard = (from: number, to: number, ...points: V3[]) => hull(points, unit(sub(points[to], points[from])));
  return [
    // the foot, leaning from the floor on the left up to the right
    shard(0, 3, at(165, 1127, 1.6), at(345, 1127, 2.0), at(528, 735, 1.3), at(705, 510, -0.8), at(430, 730, -0.6)),
    // the one across it, from the floor up to the right
    shard(0, 2, at(365, 1127, 0.1), at(535, 850, 1.7), at(915, 400, 0.9), at(610, 560, -0.4), at(690, 690, 1.6)),
    // low, out to a point on the right
    shard(1, 0, at(998, 788, 0.9), at(270, 1040, -0.5), at(470, 965, 1.4), at(560, 830, -1.0), at(660, 925, 0.9)),
    // from a point on the left, back under the crossing
    shard(0, 1, at(30, 648, 0.6), at(600, 575, -1.1), at(500, 775, 0.6), at(560, 655, 1.3), at(330, 600, -0.3)),
    // the long one right across
    shard(0, 1, at(32, 662, 0.9), at(1130, 165, -0.6), at(520, 400, 1.1), at(800, 265, -1.0), at(850, 440, 0.8), at(300, 585, -0.5)),
    // from the point on the right up and back
    shard(0, 1, at(998, 785, 0.8), at(590, 450, -1.2), at(700, 620, 0.8), at(730, 715, -0.6)),
    // the leaning one at the upper left
    shard(0, 1, at(245, 402, 0.6), at(335, 40, -0.2), at(500, 120, 0.3), at(350, 345, 1.1), at(290, 190, -0.8)),
    // the top sheet
    shard(0, 1, at(230, -70, -0.4), at(812, 296, 0.5), at(700, -60, -1.1), at(450, 135, 0.9), at(600, 60, 0.7)),
    // on the right, going out of the long one
    shard(0, 1, at(770, 500, -1.3), at(1140, 230, -1.9), at(1120, 395, -1.1), at(900, 440, -0.4)),
    // wedges lying on the floor
    shard(0, 1, at(545, 975, -1.6), at(880, 1127, 0.4), at(545, 1127, 1.5), at(640, 1127, -1.6)),
    shard(0, 1, at(95, 1030, -2.4), at(420, 1127, -1.8), at(120, 1127, -3.0), at(260, 1050, -2.6)),
    // the upright sliver at the crossing
    shard(0, 1, at(602, 455, 0.5), at(530, 850, 1.3), at(630, 600, 1.5), at(550, 640, 0.6)),
  ];
}

export function packBlades(list: Blade[]) {
  const out = new Float32Array(BLADES * (FACES + 2) * 4);
  list.forEach((b, i) => {
    const at = i * (FACES + 2) * 4;
    out.set([...b.middle, b.reach, ...b.axis, b.planes.length], at);
    for (let f = 0; f < FACES; f++) {
      const p = b.planes[f] ?? [0, 1, 0, 1e6];
      for (let c = 0; c < 4; c++) out[at + 8 + (f >> 2) * 16 + c * 4 + (f & 3)] = p[c]; // (as `four` in trace.wgsl)
    }
  });
  return out;
}
