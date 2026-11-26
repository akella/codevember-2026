/**
 * index.html: where everything is. Each lives over and over, a function of its age: it is let down on its
 * thread into its place, hangs there cream white, the light comes up in it, and when it is all aglow its web tears
 * rope by rope (../alone/tear.ts, as rain.html's), it falls, and what is left of the web is drawn up out of the
 * picture before the next is let down.
 */
import { matOf, type Tear } from "../alone/tear";
import { GIVES, OVER } from "../rain/fall";

export type Pose = { R: number[]; t: number[] };
export type Column = { id: number; x: number; z: number; /** its middle's height while it hangs */ rest: number; phase: number; face: number; /** its age when its web starts to give */ wait: number; swing: [number, number, number, number] };

/** seconds a life takes, and the loop */
export const LIFE = 26;
/** the tearing is played this fast */
const RATE = 1.3;
/** the camera: how far from the sharp layer, and how high */
export const EYE = { dist: 8.2, y: 0.15 };
const TAN = Math.tan((14 * Math.PI) / 180);
/** half the picture's height at a depth */
export const high = (z: number) => (EYE.dist - z) * TAN;
/** let down into its place in so many seconds; aglow from then and in so many more */
const DOWN = 4.5;
const GLOW = [7, 12];

// composed for a square picture (a wider one spreads them, `wide`): where each hangs as it is seen, then made into
// places at its depth. The sag of the web (a third of a unit) is in `rest`.
const at = (id: number, x: number, y: number, z: number, phase: number, face: number, wait: number, swing: Column["swing"]): Column => ({ id, x: x * high(z), z, rest: EYE.y + y * high(z) + 0.33, phase, face, wait, swing });
export const COLUMNS: Column[] = [
  // sharp: up on the left, down on the right
  at(0, -0.4, 0.22, 0.0, 0.0, 0.4, 12.2, [0.008, 0.3, 0.007, 1.9]),
  at(1, 0.38, -0.38, -0.4, 0.5, 2.1, 12.8, [0.007, 2.2, 0.009, 0.4]),
  // and one more at the bottom on the left, sharp too: just behind the others (between sharp and soft, the lens's
  // small blurs are blotchy)
  at(2, -0.5, -0.72, -0.6, 0.27, 3.6, 12.4, [0.006, 1.4, 0.008, 3.1]),
  // before them, soft: a big one at the right, one at the top left
  at(3, 1.05, 0.15, 3.3, 0.71, 4.0, 11.8, [0.006, 4.1, 0.006, 2.8]),
  at(0, -1.0, 0.85, 2.6, 0.14, 5.2, 12.4, [0.009, 1.1, 0.007, 5.0]),
  // behind
  at(1, 0.25, 0.62, -3.5, 0.86, 1.3, 12.0, [0.007, 3.3, 0.008, 0.9]),
  at(2, 0.75, -0.75, -4.8, 0.62, 3.3, 12.6, [0.008, 5.6, 0.006, 3.7]),
  at(3, -0.8, -0.1, -4.2, 0.39, 0.9, 12.1, [0.006, 0.7, 0.009, 2.2]),
  at(0, 0.0, 0.05, -7.0, 0.95, 2.6, 12.3, [0.007, 4.4, 0.007, 1.2]),
];

const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const mul = (a: number[], b: number[]) => {
  const o: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  return o;
};
const on = (m: number[], v: number[]) => [0, 1, 2].map((r) => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]);
const after = (a: Pose, b: Pose): Pose => ({ R: mul(a.R, b.R), t: on(a.R, b.t).map((x, k) => x + a.t[k]) });

/** when it comes off its web */
const lastOf = (c: Column, tear: Tear) => tear.last / RATE + c.wait;

/** how much light is in it, before the flicker: none, then it comes up, and it is all aglow when its web gives */
export const aglow = (age: number) => ease((age - GLOW[0]) / (GLOW[1] - GLOW[0]));

/** where it is, and its web and thread, at loop time t; `wide` spreads the columns as the picture is wide */
export const where = (c: Column, tears: Tear[], t: number, sway: number, wide: number) => {
  const tear = tears[c.id];
  const age = ((((t + c.phase) % 1) + 1) % 1) * LIFE;
  const last = lastOf(c, tear);
  const x = c.x * wide;
  // let down from above the picture, slowing into its place
  const top = high(c.z) + 1.6;
  const y = c.rest + (top - c.rest) * (1 - ease(age / DOWN));
  // when nothing holds it, what is left of the line goes up again, out of the picture
  const gone = Math.max(0, age - last);
  const spare = LIFE - 0.1 - last;
  const rise = (top - c.rest + OVER + 1.5) * ease((gone - 0.15) / (spare - 0.2));

  const g = Math.min(Math.max(0, (age - c.wait) * RATE * tear.fps), tear.frames - 1.001);
  const f = Math.floor(g);
  const w = g - f;
  const B = tear.body;
  const p = [0, 1, 2].map((k) => B[f * 7 + k] * (1 - w) + B[f * 7 + 7 + k] * w);
  const q0 = [3, 4, 5, 6].map((k) => B[f * 7 + k]);
  const q1 = [3, 4, 5, 6].map((k) => B[f * 7 + 7 + k]);
  const sign = q0.reduce((a, v, k) => a + v * q1[k], 0) < 0 ? -1 : 1;
  let q = q0.map((v, k) => v * (1 - w) + sign * q1[k] * w);
  const l = Math.hypot(...q);
  q = q.map((v) => v / l);
  const end = [0, 1, 2].map((k) => tear.end[f * 3 + k] * (1 - w) + tear.end[f * 3 + 3 + k] * w);

  // the whole line sways a little, from far above, and is turned to face anywhere
  const two = Math.PI * 2;
  const [ax, az] = [sway * c.swing[0] * Math.sin(two * 3 * t + c.swing[1]), sway * c.swing[2] * Math.sin(two * 2 * t + c.swing[3])];
  const S = mul([1, 0, 0, 0, Math.cos(ax), -Math.sin(ax), 0, Math.sin(ax), Math.cos(ax)], [Math.cos(az), -Math.sin(az), 0, Math.sin(az), Math.cos(az), 0, 0, 0, 1]);
  const pivot = [0, 9, 0];
  const swung: Pose = { R: S, t: on(S, pivot).map((v, k) => pivot[k] - v) };
  const turn = [Math.cos(c.face), 0, Math.sin(c.face), 0, 1, 0, -Math.sin(c.face), 0, Math.cos(c.face)];
  const placed = (dy: number): Pose => after({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [x, y + dy, c.z] }, after(swung, { R: turn, t: [0, 0, 0] }));
  const below = placed(0);
  const above = placed(rise);
  // the thread leans and stretches to where its end is
  const cord = after(above, {
    R: [1, -end[0] / GIVES, 0, 0, 1 - end[1] / GIVES, 0, 0, -end[2] / GIVES, 1],
    t: end.map((e) => (e * (OVER + GIVES)) / GIVES),
  });
  let torn = 0;
  for (const s of tear.snaps) if (s <= g / tear.fps) torn++;
  return { body: after(below, { R: matOf(q), t: p }), above, below, cord, frame: g, age, gone, torn: torn / tear.snaps.length, x };
};
