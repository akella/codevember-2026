// Ball schedules that loop exactly with the dance: every ball goes from contact to contact with the
// dancer's limbs, flying a true parabola in between. Knowing both ends and the flight time fixes the
// throw, v0 = dp / dt + g dt / 2 upwards. Gravity doesn't act sideways, so a bounce off a frame wall
// is just x folded at the wall, which is exactly an elastic bounce.
// Contacts come from the clip (keepie-uppie: the moments a limb swings up hardest) or from a siteswap
// on even beats (juggling). Both repeat once a loop, so every ball's path closes.

export const LIMBS = ["left foot", "right foot", "left hand", "right hand"] as const;
export type Limb = (typeof LIMBS)[number];

/** limb tips and the body's centre in sheet space, sampled evenly over one loop */
export type Tracks = { samples: number; tips: Record<Limb, Float32Array>; centre: Float32Array };

type Arc = {
  kind: "fly";
  t0: number;
  dt: number;
  x0: number;
  y0: number;
  vx: number;
  vy: number;
};
type Hold = { kind: "hold"; t0: number; dt: number; limb: Limb };
type Segment = Arc | Hold;

/**
 * A ball's path may take several loops to come back (in a cascade, balls swap hands each loop), but
 * identical balls make the picture repeat every loop anyway: a path of m loops is drawn as m balls,
 * a loop apart along it.
 */
export type Path = { segments: Segment[]; loops: number };
export type Schedule = { paths: Path[]; gravity: number; error?: string };

/** how many balls a schedule draws */
export const ballCount = (s: Schedule) => s.paths.reduce((a, p) => a + p.loops, 0);

export type PlanSettings = {
  gravity: number;
  /** half size of the space a ball centre may use: the opening less the ball and its cut */
  room: number;
  radius: number;
  /** how far out from the limb tip a ball sits when touching it */
  offset: number;
  /** share of throws sent off a side wall */
  walls: number;
  /** how flat a wall throw may be: its sideways speed against its upward launch speed */
  steep: number;
  seed: number;
};

const wrap = (t: number) => t - Math.floor(t);

/** a limb tip's position at a point in the loop, nudged outward from the body by the touch distance */
export function contact(tracks: Tracks, limb: Limb, t: number, offset: number) {
  const n = tracks.samples;
  const f = wrap(t) * n;
  const i = Math.floor(f) % n, j = (i + 1) % n, k = f - Math.floor(f);
  const tip = tracks.tips[limb], c = tracks.centre;
  const x = tip[i * 2] * (1 - k) + tip[j * 2] * k;
  const y = tip[i * 2 + 1] * (1 - k) + tip[j * 2 + 1] * k;
  const cx = c[i * 2] * (1 - k) + c[j * 2] * k;
  const cy = c[i * 2 + 1] * (1 - k) + c[j * 2 + 1] * k;
  const l = Math.hypot(x - cx, y - cy) || 1;
  return [x + ((x - cx) / l) * offset, y + ((y - cy) / l) * offset];
}

function velocity(tracks: Tracks, limb: Limb, t: number) {
  const e = 1 / tracks.samples;
  const a = contact(tracks, limb, t - e, 0), b = contact(tracks, limb, t + e, 0);
  return [(b[0] - a[0]) / (2 * e), (b[1] - a[1]) / (2 * e)];
}

/** fold a free x back inside the walls, as bounces */
function fold(x: number, room: number) {
  const w = 4 * room;
  let u = (((x + room) % w) + w) % w;
  if (u > 2 * room) u = w - u;
  return u - room;
}

/**
 * A flight from p0 at t0 to p1 after dt, in loop time. `bounces` sends it off a side wall that many
 * times, by aiming at the target's mirror image beyond the wall.
 */
function fly(t0: number, dt: number, p0: number[], p1: number[], g: number, room: number, bounces: number): Arc {
  let tx = p1[0];
  if (bounces !== 0) {
    // the mirror image across the wall on the side we're sent to
    const side = Math.sign(bounces);
    tx = side * 2 * room - p1[0];
  }
  return { kind: "fly", t0, dt, x0: p0[0], y0: p0[1], vx: (tx - p0[0]) / dt, vy: (p1[1] - p0[1]) / dt + (g * dt) / 2 };
}

function apex(a: Arc, g: number) {
  if (a.vy <= 0) return a.y0;
  const t = Math.min(a.vy / g, a.dt);
  return a.y0 + a.vy * t - (g * t * t) / 2;
}

/** where drawn ball `index` is at loop time t */
export function position(schedule: Schedule, tracks: Tracks, index: number, t: number, s: PlanSettings) {
  let i = index;
  for (const path of schedule.paths) {
    if (i >= path.loops) {
      i -= path.loops;
      continue;
    }
    // this ball runs a loop behind the one before it on the same path
    const time = (((t - Math.floor(t)) + i) % path.loops + path.loops) % path.loops;
    for (const seg of path.segments) {
      let u = time - seg.t0;
      u -= Math.floor(u / path.loops) * path.loops;
      if (u > seg.dt) continue;
      if (seg.kind === "hold") return contact(tracks, seg.limb, seg.t0 + u, s.offset);
      const g = schedule.gravity;
      return [fold(seg.x0 + seg.vx * u, s.room), seg.y0 + seg.vy * u - (g * u * u) / 2];
    }
    return [0, 0];
  }
  return [0, 0];
}

/**
 * Turn contacts into flights. Each path's contacts are (time, limb) with times increasing, in loops,
 * and the path closes after a whole number of loops. Gravity drops below the setting if that's what it
 * takes to keep every arc under the top of the frame.
 */
function build(contacts: { t: number; limb: Limb; hold?: number }[][], tracks: Tracks, s: PlanSettings, wallShare?: number[]): Schedule {
  const rand = (() => {
    let x = s.seed * 2654435761 + 1;
    return () => {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      return (x >>> 0) / 4294967296;
    };
  })();
  // a path closes after however many whole loops its contacts span
  const loops = contacts.map((list) => Math.max(1, Math.ceil(list[list.length - 1].t - list[0].t + 1e-6)));
  // which flights go off a wall: chosen once, so changing gravity doesn't reshuffle them
  const walls = contacts.map((c, b) => c.map(() => (rand() < (wallShare?.[b] ?? s.walls) ? (rand() < 0.5 ? -1 : 1) : 0)));
  const make = (g: number): Path[] =>
    contacts.map((list, b) => ({
      loops: loops[b],
      segments: list.flatMap((c, i): Segment[] => {
        const last = i === list.length - 1;
        const next = last ? { ...list[0], t: list[0].t + loops[b] } : list[i + 1];
        const hold = c.hold ?? 0;
        const dt = next.t - c.t;
        const out: Segment[] = [];
        if (hold > 0) out.push({ kind: "hold", t0: c.t, dt: hold, limb: c.limb });
        const from = contact(tracks, c.limb, c.t + hold, s.offset);
        const to = contact(tracks, next.limb, next.t, s.offset);
        // a wall only takes throws that can reach it and come back as a real arc: sideways no faster
        // than about the speed it's thrown up at, or a short throw shoots across nearly flat
        let bounce = walls[b][i];
        if (bounce) {
          const t = dt - hold;
          const sideways = Math.abs(bounce * 2 * s.room - to[0] - from[0]) / t;
          if (sideways > s.steep * ((g * t) / 2)) bounce = 0;
        }
        out.push(fly(c.t + hold, dt - hold, from, to, g, s.room, bounce));
        return out;
      }),
    }));
  // the strongest gravity, up to the setting, whose highest arc still fits under the top: an arc's
  // height above its ends grows with g, so the search is a simple bisection
  const top = (g: number) => Math.max(...make(g).flatMap((p) => p.segments.map((a) => (a.kind === "fly" ? apex(a, g) : -1))));
  if (top(s.gravity) <= s.room) return { paths: make(s.gravity), gravity: s.gravity };
  let lo = 0.01, hi = s.gravity;
  if (top(lo) > s.room) return { paths: make(lo), gravity: lo, error: "arcs leave the frame even flat" };
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (top(mid) <= s.room) lo = mid;
    else hi = mid;
  }
  return { paths: make(lo), gravity: lo };
}

// ---- keepie-uppie

/**
 * Kicks: the moments a limb swings upward hardest, at least `gap` of the loop apart, strongest first.
 * Then balls take turns: with n balls, ball j gets every n-th kick, so the count is rounded to fit.
 */
export function keepieUppie(tracks: Tracks, limbs: Limb[], kicks: number, balls: number, s: PlanSettings): Schedule {
  const n = tracks.samples;
  const found: { t: number; limb: Limb; score: number }[] = [];
  for (const limb of limbs) {
    const up = Array.from({ length: n }, (_, i) => velocity(tracks, limb, i / n)[1]);
    for (let i = 0; i < n; i++) {
      const v = up[i];
      if (v > 0 && v >= up[(i + n - 1) % n] && v >= up[(i + 1) % n]) found.push({ t: i / n, limb, score: v });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const want = Math.max(balls, Math.round(kicks / balls) * balls);
  const gap = 0.5 / want;
  const chosen: typeof found = [];
  for (const f of found) {
    if (chosen.length >= want) break;
    if (chosen.some((c) => Math.abs(wrap(c.t - f.t + 0.5) - 0.5) < gap)) continue;
    chosen.push(f);
  }
  const count = Math.floor(chosen.length / balls) * balls;
  if (count < balls) return { paths: [], gravity: s.gravity, error: "no kicks found" };
  const events = chosen.slice(0, count).sort((a, b) => a.t - b.t);
  const lists = Array.from({ length: balls }, (_, j) => events.filter((_, i) => i % balls === j));
  return build(lists, tracks, s);
}

// ---- juggling

/** a siteswap as throw heights, or an error if no juggler could do it */
export function parseSiteswap(text: string): number[] | string {
  const digits = text.replace(/\s/g, "").toLowerCase().split("").map((c) => parseInt(c, 36));
  if (!digits.length || digits.some((d) => Number.isNaN(d))) return "use digits, like 531";
  const n = digits.length;
  const land = new Set(digits.map((d, i) => (i + d) % n));
  if (land.size !== n) return "two balls land on one beat";
  return digits;
}

/** one juggling layer: a siteswap on even beats between two limbs, offset by part of a beat */
export type Layer = { pattern: number[]; beats: number; limbs: [Limb, Limb]; dwell: number; offset: number; walls: number };

/**
 * A siteswap on `beats` even beats a loop, alternating between two limbs. Throw h from beat b lands
 * on beat b + h; 2s are held, 0s are an empty hand. The pattern's length must divide the beats.
 */
function layerContacts(l: Layer): { t: number; limb: Limb; hold?: number }[][] | string {
  if (l.beats % l.pattern.length) return `beats must be a multiple of ${l.pattern.length}`;
  const throws = Array.from({ length: l.beats }, (_, b) => l.pattern[b % l.pattern.length]);
  const seen = new Set<number>();
  const lists: { t: number; limb: Limb; hold?: number }[][] = [];
  const beat = 1 / l.beats;
  for (let start = 0; start < l.beats; start++) {
    if (seen.has(start) || throws[start] === 0) continue;
    // follow one ball round until it comes back to the beat it started on
    const list: { t: number; limb: Limb; hold?: number }[] = [];
    let b = start;
    // beats counted on without wrapping, so times keep increasing round the path
    let at = start;
    do {
      seen.add(b);
      const h = throws[b];
      // a held 2 stays in the hand; other throws leave after a short dwell
      list.push({ t: (at + l.offset) * beat, limb: l.limbs[at % 2], hold: h === 2 ? 2 * beat * 0.999 : Math.min(l.dwell, h - 0.1) * beat });
      at += h;
      b = at % l.beats;
    } while (b !== start && list.length < l.beats * 8);
    lists.push(list);
  }
  return lists;
}

/**
 * Juggling in layers, say a cascade on the feet and another pattern on the hands, planned together so
 * every ball falls under the same gravity.
 */
export function juggle(tracks: Tracks, layers: Layer[], s: PlanSettings): Schedule {
  const lists: { t: number; limb: Limb; hold?: number }[][] = [];
  const shares: number[] = [];
  for (const l of layers) {
    const c = layerContacts(l);
    if (typeof c === "string") return { paths: [], gravity: s.gravity, error: c };
    lists.push(...c);
    shares.push(...c.map(() => l.walls));
  }
  if (!lists.length) return { paths: [], gravity: s.gravity, error: "no balls" };
  return build(lists, tracks, s, shares);
}
