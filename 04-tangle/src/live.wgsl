// Discrete Elastic Rods on the GPU: sim/rods.ts, one workgroup per rope.
//
// A rope is a ring of W nodes in `state`. Local index i runs from the oldest node (0) to the
// newest (W - 1), like the array index in rods.ts, so i + 1 is towards the head. Each kernel
// loads a rope into workgroup memory by i, which turns the ring into a plain array.
//
// What changes from the CPU is what can't run in parallel: Thomas solves become parallel cyclic
// reduction, and contacts are gathered per edge instead of applied one pair at a time.

const W: u32 = 256u;
const LEAD: i32 = 3;
const SPEED_LIMIT: f32 = 30.0;
const TAU: f32 = 6.283185307179586;
const MAX_NEAR: u32 = 95u; // collision candidates per edge, slot 0 of each row is the count
const ROW: u32 = 96u;
const BUCKETS: u32 = 65536u;
const NONE: u32 = 0xffffffffu;
const PAST: u32 = 128u; // nodes kept per rope after they leave the ring

struct Rope {
  K: u32,
  base: u32, // nodes laid in loops already finished: where the ring has got to
  startK: f32,
  shrink: f32,
};

struct Params {
  ropes: u32, nodes: u32, lo: i32, hi: i32,
  dt: f32, fade: f32, bend: f32, twist: f32,
  density: f32, radius: f32, spacing: f32, friction: f32,
  separate: f32, shrinkFrom: f32, shrinkTo: f32, soften: f32,
  pitch: f32, spin: f32, h0: f32, shift: f32,
  scroll: f32, relax: f32, width: u32, tableStride: u32,
  gravity: vec4f,
  grabAt: vec4f, // xyz where the hand is, w how hard it pulls, 0 for no hand
  grab: u32, tolerance: f32, pull: f32, give: f32, // give: how slack the rope in the hand has gone
  ease: f32, lag: f32, steady: f32, unused: f32, // ease: nodes over which the curve lets go of the rope
  // closing a loop, see closeLoop in live.ts. Offsets into `kept`, NONE for not doing that
  feedback: f32, feedbackDamp: f32, aim: u32, aimNext: u32, // the two samples of past laps either side of now
  aimMix: f32, aimStep: f32, aimSpeed: f32, mean: u32, // how far between them, per substep, and samples to speed
  remember: u32, keep: u32, blend: u32, blendBy: f32, // what to write this frame, and the frame to turn into
  ribbon: vec4f, // a flat lace's half width and half thickness in radii, how fast it turns and lets go. 0 for round rope
  rope: array<Rope, 32>,
};

struct Substep { index: u32 };

@group(0) @binding(0) var<storage, read_write> state: array<vec4f>;
@group(0) @binding(1) var<storage, read> heads: array<f32>; // per substep: warm, then h per rope
@group(0) @binding(2) var<storage, read> curves: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> tops: array<u32>;
@group(0) @binding(4) var<storage, read_write> buckets: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> chain: array<u32>;
@group(0) @binding(6) var<storage, read_write> nearby: array<u32>;
@group(0) @binding(7) var<uniform> P: Params;
@group(0) @binding(8) var<uniform> sub: Substep;
@group(0) @binding(9) var nodeTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(10) var frameTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(11) var<storage, read_write> kept: array<vec4f>;

// sections of `state`, each P.nodes long
fn X() -> u32 { return 0u; } // xyz, w the laid length of the edge to the next node
fn XP() -> u32 { return P.nodes; }
fn V() -> u32 { return P.nodes * 2u; }
fn U() -> u32 { return P.nodes * 3u; } // reference director, w the material angle θ
fn T() -> u32 { return P.nodes * 4u; } // tangent, w the reference twist
fn CA() -> u32 { return P.nodes * 5u; } // what an edge's contacts ask of its first node
fn CB() -> u32 { return P.nodes * 6u; } // and of its second
fn D() -> u32 { return P.nodes * 7u; } // the direction a ribbon faces on screen
fn E() -> u32 { return P.nodes * 8u; } // how a ribbon is drawn: x its turn from the rod, y how squeezed, 0 to 1
fn F() -> u32 { return P.nodes * 9u; } // the same, on its way: `dress` writes this and publish takes it up
// Rope that has left the ring: too old to move, but it still has to reach out of shot. Two rows
// per node: xyz and which node it is, then the way it faces
fn pastOf(r: u32, n: i32) -> u32 { return P.nodes * 10u + (r * PAST + u32(n) % PAST) * 2u; }

/** Where a node sits in a sample of a lap: by array index, which comes round again each lap */
fn lapSlot(r: u32, j: i32) -> u32 { return r * W + (u32(j) & (W - 1u)); }

fn warmth() -> f32 { return heads[sub.index * (P.ropes + 1u)]; }
fn headOf(r: u32) -> f32 { return heads[sub.index * (P.ropes + 1u) + 1u + r]; }
fn topOf(r: u32) -> i32 { return i32(floor(headOf(r))) + LEAD; }
fn nodeAt(r: u32, j: i32) -> u32 { return r * W + (u32(j + i32(P.rope[r].base)) % W); }

/** Local index of a node, from where it sits in the ring */
fn localOf(g: u32) -> i32 {
  let r = g / W;
  let oldest = u32(topOf(r) - 255 + i32(P.rope[r].base)) % W;
  return i32(((g % W) + W - oldest) % W);
}
fn nextOf(g: u32) -> u32 { return (g / W) * W + (g + 1u) % W; }
fn previousOf(g: u32) -> u32 { return (g / W) * W + (g + W - 1u) % W; }
fn weightOf(i: i32) -> f32 { return select(0.0, 1.0, i >= P.lo && i <= P.hi); }

fn smooth01(a: f32, b: f32, x: f32) -> f32 {
  let t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn tablePoint(r: u32, i: i32) -> vec3f {
  let K = i32(P.rope[r].K);
  // in integers: GPU division isn't exact, and 705.0 / 235.0 just under 3 reads the next rope's table
  var wrap = i / K;
  if (i - wrap * K < 0) { wrap -= 1; }
  let p = curves[r * P.tableStride + u32(i - wrap * K)].xyz;
  return p + vec3f(f32(wrap) * P.pitch, 0.0, 0.0);
}

/** Curve position at a laid index: curveAt in paths.ts */
fn curveAt(r: u32, j: f32) -> vec3f {
  let i1 = i32(floor(j));
  let f = j - f32(i1);
  let a = tablePoint(r, i1 - 1);
  let b = tablePoint(r, i1);
  let c = tablePoint(r, i1 + 1);
  let d = tablePoint(r, i1 + 2);
  return b + 0.5 * f * (c - a + f * (2.0 * a - 5.0 * b + 4.0 * c - d + f * (3.0 * (b - c) + d - a)));
}

/** Carries v from unit tangent a to b by the shortest rotation */
fn transport(v: vec3f, a: vec3f, b: vec3f) -> vec3f {
  let w = cross(a, b);
  let c = 1.0 / (1.0 + dot(a, b));
  let p = cross(w, v);
  return v + p + cross(w, p) * c;
}

/** Signed angle from u0 on the edge before, carried over, to u1 on this edge */
fn referenceTwist(u0: vec3f, t0: vec3f, u1: vec3f, t1: vec3f, before: f32) -> f32 {
  let q = transport(u0, t0, t1);
  let angle = atan2(dot(cross(q, u1), t1), dot(q, u1));
  return angle + TAU * round((before - angle) / TAU);
}

// ---- workgroup memory: 14 KB of the 16 the spec promises

var<workgroup> sx: array<vec4f, 256>; // positions, w the current rest length of the edge
var<workgroup> sa: array<vec4f, 256>; // scratch, and the a b c d rows of a tridiagonal system
var<workgroup> sb: array<vec4f, 256>; // scratch
var<workgroup> sl: array<f32, 256>;
var<workgroup> st: array<f32, 256>;
var<workgroup> worst: atomic<u32>;
var<workgroup> longest: atomic<u32>;
var<workgroup> worstSeen: f32;

/**
 * Parallel cyclic reduction: each step folds in the rows `s` away, so after log2(W) steps every
 * row stands alone and its unknown is d / b. Rows outside a system are (0, 1, 0, 0).
 */
fn reduceRows(i: u32) {
  for (var s = 1u; s < W; s = s * 2u) {
    let m = sa[i];
    var below = vec4f(0.0, 1.0, 0.0, 0.0);
    var above = vec4f(0.0, 1.0, 0.0, 0.0);
    if (i >= s) { below = sa[i - s]; }
    if (i + s < W) { above = sa[i + s]; }
    let alpha = -m.x / below.y;
    let gamma = -m.z / above.y;
    let folded = vec4f(
      alpha * below.x,
      m.y + alpha * below.z + gamma * above.x,
      gamma * above.z,
      m.w + alpha * below.w + gamma * above.w,
    );
    workgroupBarrier();
    sa[i] = folded;
    workgroupBarrier();
  }
}

/** Goldenthal's fast projection, as in rods.ts: Newton steps on the edge lengths */
fn project(i: u32, sweeps: u32) {
  let ii = i32(i);
  let first = P.lo - 1;
  let last = P.hi;
  for (var sweep = 0u; sweep < sweeps; sweep++) {
    if (i == 0u) {
      atomicStore(&worst, 0u);
      atomicStore(&longest, 0u);
    }
    workgroupBarrier();
    var row = vec4f(0.0, 1.0, 0.0, 0.0);
    if (ii >= first && ii <= last) {
      let e = sx[i + 1u].xyz - sx[i].xyz;
      let ee = dot(e, e);
      let l = sx[i].w;
      let C = ee / l - l;
      atomicMax(&worst, bitcast<u32>(abs(C) / l));
      let wa = select(1.0, 0.0, ii == first);
      let wb = select(1.0, 0.0, ii == last);
      row.y = 4.0 * ee * (wa + wb) / (l * l) + 1e-3;
      row.w = C;
      if (ii < last) {
        let f = sx[i + 2u].xyz - sx[i + 1u].xyz;
        row.z = -4.0 * dot(e, f) / (l * sx[i + 1u].w);
      }
      if (ii > first) {
        let f = sx[i].xyz - sx[i - 1u].xyz;
        row.x = -4.0 * dot(f, e) / (sx[i - 1u].w * l);
      }
    }
    sa[i] = row;
    workgroupBarrier();
    if (i == 0u) { worstSeen = bitcast<f32>(atomicLoad(&worst)); }
    if (workgroupUniformLoad(&worstSeen) < P.tolerance) { break; }
    reduceRows(i);
    sl[i] = sa[i].w / sa[i].y;
    workgroupBarrier();
    var change = vec3f(0.0);
    if (ii > first && ii <= last) {
      let p0 = 2.0 * sl[i - 1u] / sx[i - 1u].w;
      let p1 = 2.0 * sl[i] / sx[i].w;
      change = p0 * (sx[i].xyz - sx[i - 1u].xyz) - p1 * (sx[i + 1u].xyz - sx[i].xyz);
      atomicMax(&longest, bitcast<u32>(dot(change, change)));
    }
    workgroupBarrier();
    let scale = min(1.0, P.separate * P.dt / (sqrt(bitcast<f32>(atomicLoad(&longest))) + 1e-12));
    sx[i] = vec4f(sx[i].xyz - change * scale, sx[i].w);
    workgroupBarrier();
  }
}

fn facingOf(g: u32) -> vec3f {
  let u = state[U() + g];
  return cos(u.w) * u.xyz + sin(u.w) * cross(state[T() + g].xyz, u.xyz);
}

/** The way a ribbon's flat runs: the rod's own direction, turned as `dress` has it */
fn dressedFacing(g: u32, turn: f32) -> vec3f {
  let facing = facingOf(g);
  return cos(turn) * facing + sin(turn) * cross(state[T() + g].xyz, facing);
}

/** New rope leaves the curve at the top of the ring: `lay` in rods.ts, one node at a time */
fn lay(r: u32, j: i32) {
  let g = nodeAt(r, j);
  // the node this replaces goes on being drawn
  let leaving = j + i32(P.rope[r].base) - i32(W);
  if (leaving >= 0) {
    let past = pastOf(r, leaving);
    state[past] = vec4f(state[X() + g].xyz, f32(leaving));
    state[past + 1u] = vec4f(dressedFacing(g, state[E() + g].x), state[E() + g].y);
  }
  let before = nodeAt(r, j - 1);
  let q = f32(j) - P.h0 + P.rope[r].startK;
  let here = curveAt(r, q);
  let e = curveAt(r, q + 1.0) - here;
  let l = length(e);
  let t = e / l;
  let t0 = state[T() + before].xyz;
  let u0 = state[U() + before].xyz;
  let u = normalize(transport(u0, t0, t) - t * dot(transport(u0, t0, t), t));
  // radial direction, spun by any laid-in twist: the material frame is fixed to the curve
  let across = vec3f(0.0, here.y, here.z);
  let radial = normalize(across - t * dot(across, t) + vec3f(1e-9, 0.0, 0.0));
  let spun = TAU * P.spin * q / f32(P.rope[r].K);
  var angle = atan2(dot(radial, cross(t, u)), dot(radial, u)) + spun;
  angle += TAU * round((state[U() + before].w - angle) / TAU);
  state[X() + g] = vec4f(here, l);
  state[XP() + g] = vec4f(here, l);
  state[V() + g] = vec4f(0.0);
  state[U() + g] = vec4f(u, angle);
  state[T() + g] = vec4f(t, referenceTwist(u0, t0, u, t, 0.0));
  state[D() + g] = vec4f(0.0);
  state[E() + g] = vec4f(0.0);
  state[F() + g] = vec4f(0.0);
}

/** A held rope pays out: it stops shrinking and squeezing, or nothing could be drawn out of a knot */
fn tautness(r: u32) -> f32 { return select(1.0, 1.0 - P.give, r == P.grab / W); }

/** Loads a rope by local index, with every edge at its current rest length */
fn loadRope(r: u32, i: u32) -> u32 {
  let h = headOf(r);
  let j = topOf(r) - 255 + i32(i);
  let g = nodeAt(r, j);
  let p = state[X() + g];
  let shrink = (P.rope[r].shrink - 1.0) * warmth() * smooth01(P.shrinkFrom, P.shrinkTo, h - f32(j)) * tautness(r);
  sx[i] = vec4f(p.xyz, p.w * (1.0 + shrink));
  sl[i] = p.w;
  return g;
}

@compute @workgroup_size(256)
fn predict(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) i: u32) {
  let r = group.x;
  let ii = i32(i);

  // a loop has ended: everything moves back one pitch, by slot so a node is only moved once
  if (sub.index == 0u && P.shift != 0.0) {
    let s = r * W + i;
    state[X() + s].x -= P.shift;
    state[XP() + s].x -= P.shift;
    if (i < PAST) { state[pastOf(r, i32(i))].x -= P.shift; }
  }
  storageBarrier();
  workgroupBarrier();

  if (i == W - 1u) {
    let top = topOf(r);
    let base = i32(P.rope[r].base);
    for (var n = i32(tops[r]) + 1; n <= top + base; n++) { lay(r, n - base); }
    tops[r] = u32(top + base);
  }
  storageBarrier();
  workgroupBarrier();

  let g = loadRope(r, i);
  let material = state[U() + g];
  let tangent = state[T() + g];
  st[i] = material.w;
  workgroupBarrier();

  // bending and twisting at each vertex, gathered onto its three nodes afterwards
  var fa = vec3f(0.0);
  var fb = vec3f(0.0);
  if (ii >= P.lo - 1 && ii <= P.hi + 1) {
    let e0 = sx[i].xyz - sx[i - 1u].xyz;
    let e1 = sx[i + 1u].xyz - sx[i].xyz;
    let l0 = sx[i - 1u].w;
    let l1 = sx[i].w;
    let lengths = sqrt(dot(e0, e0) * dot(e1, e1));
    let D = max(lengths + dot(e0, e1), 0.15 * lengths);
    let k = cross(e0, e1) * (2.0 / D);
    let kk = dot(k, k);
    let bl = 2.0 * P.bend / (l0 + l1) / D;
    fa = -bl * (2.0 * cross(k, e1) + e1 * kk);
    fb = -bl * (2.0 * cross(k, e0) - e0 * kk);
    if (P.twist != 0.0) {
      let m = material.w - st[i - 1u] + tangent.w;
      let c = 2.0 * P.twist * m / (l0 + l1);
      fa += k * (c / (2.0 * l0));
      fb -= k * (c / (2.0 * l1));
    }
  }
  sa[i] = vec4f(fa, 0.0);
  sb[i] = vec4f(fb, 0.0);
  workgroupBarrier();

  state[XP() + g] = vec4f(sx[i].xyz, sl[i]);
  var moved = sx[i].xyz;
  if (ii >= P.lo && ii <= P.hi) {
    let force = sa[i + 1u].xyz + sb[i - 1u].xyz - sa[i].xyz - sb[i].xyz;
    let m = P.density * 0.5 * (sl[i - 1u] + sl[i]);
    var accel = force / m + P.gravity.xyz;
    if (P.pull != 0.0) {
      // towards the axis, ramped in with the shrink: this is what closes a knot
      let across = vec3f(0.0, sx[i].y, sx[i].z);
      let ramp = smooth01(P.shrinkFrom, P.shrinkTo, headOf(r) - f32(topOf(r) - 255 + ii));
      accel -= across * (P.pull * tautness(r) * warmth() * ramp / (length(across) + 1e-6));
    }
    var v = state[V() + g].xyz;
    if (P.grabAt.w > 0.0 && g / W == P.grab / W) {
      // the hand pulls a short run of rope, not one node, which would only fold it
      let centre = localOf(P.grab);
      let away = f32(ii - centre);
      let held = state[X() + P.grab].xyz;
      let heldSpeed = state[V() + P.grab].xyz;
      var pull = P.grabAt.w * (P.grabAt.xyz - held) - 2.0 * sqrt(P.grabAt.w) * heldSpeed;
      let size = length(pull);
      pull *= min(1.0, 3000.0 / (size + 1e-6));
      accel += pull * exp(-away * away / 60.0);
    }
    if (P.feedback > 0.0) {
      // towards where this node was on past laps. As the laps come to agree this comes to nothing
      let slot = lapSlot(r, topOf(r) - 255 + ii);
      let before = kept[P.aim + slot].xyz;
      let after = kept[P.aimNext + slot].xyz;
      let aim = mix(before, after, P.aimMix + P.aimStep * f32(sub.index));
      accel += P.feedback * (aim - sx[i].xyz) + P.feedbackDamp * ((after - before) * P.aimSpeed - v);
    }
    v = (v + accel * P.dt) * P.fade;
    let speed = dot(v, v);
    v *= select(1.0, SPEED_LIMIT / sqrt(speed), speed > SPEED_LIMIT * SPEED_LIMIT);
    state[V() + g] = vec4f(v, 0.0);
    moved += v * P.dt;
    if (P.ease > 0.0) {
      // Freed all at once, a node under tension snaps, and a head frees twenty a second: that is
      // the shake. So the curve lets go by degrees, from fully held to nothing
      let behind = headOf(r) - f32(topOf(r) - 255 + ii);
      let hold = 1.0 - smooth01(P.lag, P.lag + P.ease, behind);
      let laidAt = curveAt(r, f32(topOf(r) - 255 + ii) - P.h0 + P.rope[r].startK);
      moved = mix(moved, laidAt, hold * hold);
    }
  }
  workgroupBarrier();
  sx[i] = vec4f(moved, sx[i].w);
  workgroupBarrier();

  project(i, 3u);
  state[X() + g] = vec4f(sx[i].xyz, sl_laid(g));
}

fn sl_laid(g: u32) -> f32 { return state[XP() + g].w; }

@compute @workgroup_size(256)
fn settle(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) i: u32) {
  let r = group.x;
  let ii = i32(i);
  let g = loadRope(r, i);
  workgroupBarrier();
  project(i, 2u);

  // velocity from what the positions did, minus the grid-scale wiggle of explicit bending
  var v = vec3f(0.0);
  let free = ii >= P.lo && ii <= P.hi;
  if (!sane(sx[i].xyz)) { sx[i] = vec4f(state[XP() + g].xyz, sx[i].w); }
  if (free) {
    v = (sx[i].xyz - state[XP() + g].xyz) / P.dt;
    let speed = dot(v, v);
    v *= select(1.0, SPEED_LIMIT / sqrt(speed), speed > SPEED_LIMIT * SPEED_LIMIT);
  }
  sb[i] = vec4f(v, 0.0);
  workgroupBarrier();
  if (free) {
    let wiggle = sb[i - 2u].xyz - 4.0 * sb[i - 1u].xyz + 6.0 * v - 4.0 * sb[i + 1u].xyz + sb[i + 2u].xyz;
    state[V() + g] = vec4f(v - P.soften * wiggle, 0.0);
  }
  state[X() + g] = vec4f(sx[i].xyz, state[XP() + g].w);
  workgroupBarrier();

  // Bishop frames follow the tangents through time
  let first = P.lo - 1;
  let last = P.hi;
  let edge = ii >= first && ii <= last;
  var u = state[U() + g];
  var t = state[T() + g];
  if (edge) {
    let t1 = normalize(sx[i + 1u].xyz - sx[i].xyz);
    let q = transport(u.xyz, t.xyz, t1);
    u = vec4f(normalize(q - t1 * dot(q, t1)), u.w);
    t = vec4f(t1, t.w);
  }
  sa[i] = u;
  sb[i] = t;
  workgroupBarrier();
  if (ii >= first && ii <= last + 1) {
    t.w = referenceTwist(sa[i - 1u].xyz, sb[i - 1u].xyz, u.xyz, t.xyz, t.w);
  }
  st[i] = u.w;
  sl[i] = t.w;
  workgroupBarrier();

  // θ minimises twist energy with the edges either side held
  if (P.twist != 0.0) {
    var row = vec4f(0.0, 1.0, 0.0, 0.0);
    if (edge) {
      let ci = 1.0 / (sx[i - 1u].w + sx[i].w);
      let cj = 1.0 / (sx[i].w + sx[i + 1u].w);
      // solved for the change in θ: angles run to many turns, and float32 would lose the answer
      // in them, while the change is small and its rounding is smaller still
      let residual = ci * (st[i - 1u] - st[i] - sl[i]) + cj * (st[i + 1u] - st[i] + sl[i + 1u]);
      row = vec4f(select(-ci, 0.0, ii == first), ci + cj, select(-cj, 0.0, ii == last), residual);
    }
    sa[i] = row;
    workgroupBarrier();
    reduceRows(i);
    if (edge) { u.w += sa[i].w / sa[i].y; }
  }
  state[U() + g] = u;
  state[T() + g] = t;
}

// ---- contacts

fn cellOf(p: vec3f) -> vec3i {
  return vec3i(floor(p / (2.0 * P.radius + P.spacing * 1.2 + 0.06)));
}
fn bucketOf(c: vec3i) -> u32 {
  return (u32(c.x * 73856093) ^ u32(c.y * 19349663) ^ u32(c.z * 83492791)) & (BUCKETS - 1u);
}
fn middleOf(g: u32) -> vec3f { return (state[X() + g].xyz + state[X() + nextOf(g)].xyz) * 0.5; }
fn sane(p: vec3f) -> bool { return all(abs(p) < vec3f(1e4)); } // false for NaN too
fn inContact(i: i32) -> bool { return i >= max(0, P.lo - 6) && i <= P.hi + 3; }

@compute @workgroup_size(256)
fn clearGrid(@builtin(global_invocation_id) id: vec3u) {
  atomicStore(&buckets[id.x], NONE);
}

@compute @workgroup_size(64)
fn fillGrid(@builtin(global_invocation_id) id: vec3u) {
  let e = id.x;
  if (e >= P.nodes || !inContact(localOf(e))) { return; }
  // a bad node must not reach the grid: they would all share a bucket and every search would crawl
  let middle = middleOf(e);
  if (!sane(middle)) { return; }
  chain[e] = atomicExchange(&buckets[bucketOf(cellOf(middle))], e);
}

/** Each edge lists the edges close enough to touch it before the next rebuild */
@compute @workgroup_size(64)
fn findNearby(@builtin(global_invocation_id) id: vec3u) {
  let e = id.x;
  if (e >= P.nodes) { return; }
  let row = e * ROW;
  nearby[row] = 0u;
  let i = localOf(e);
  if (!inContact(i) || !sane(middleOf(e))) { return; }
  let reach = 2.0 * P.radius + P.spacing * 1.2 + 0.06;
  let skip = i32(ceil(2.0 * P.radius / P.spacing)) + 1;
  let middle = middleOf(e);
  let cell = cellOf(middle);
  var count = 0u;
  for (var a = -1; a <= 1; a++) {
    for (var b = -1; b <= 1; b++) {
      for (var c = -1; c <= 1; c++) {
        let look = cell + vec3i(a, b, c);
        var f = atomicLoad(&buckets[bucketOf(look)]);
        // bounded: a page must not be able to hang the GPU, whatever state the ropes get into
        for (var walked = 0u; walked < 256u && f != NONE; walked++) {
          let other = f;
          f = chain[other];
          if (other == e) { continue; }
          let there = middleOf(other);
          if (any(cellOf(there) != look)) { continue; }
          if (other / W == e / W && abs(localOf(other) - i) <= skip) { continue; }
          if (distance(there, middle) > reach || count >= MAX_NEAR) { continue; }
          count++;
          nearby[row + count] = other;
        }
      }
    }
  }
  nearby[row] = count;
}

/**
 * One edge against everything near it. Both edges of a pair run this, each keeping its own half,
 * so nothing is written twice and no atomics are needed.
 */
@compute @workgroup_size(64)
fn collide(@builtin(global_invocation_id) id: vec3u) {
  let e = id.x;
  if (e >= P.nodes) { return; }
  let e1 = nextOf(e);
  let i = localOf(e);
  var toFirst = vec3f(0.0);
  var toSecond = vec3f(0.0);
  let reach = 2.0 * P.radius;
  let closeBy = (reach + P.spacing * 1.1) * (reach + P.spacing * 1.1);
  let push = P.separate * P.dt;
  let count = nearby[e * ROW];
  let A = state[X() + e].xyz;
  let B = state[X() + e1].xyz;
  let stepA = A - state[XP() + e].xyz;
  let stepB = B - state[XP() + e1].xyz;
  let u = B - A;
  let a = dot(u, u);
  let wa = weightOf(i);
  let wb = weightOf(i + 1);
  for (var n = 1u; n <= count; n++) {
    let f = nearby[e * ROW + n];
    let f1 = nextOf(f);
    let C = state[X() + f].xyz;
    let D = state[X() + f1].xyz;
    let v = D - C;
    let w = A - C;
    let mid = w + (u - v) * 0.5;
    if (dot(mid, mid) > closeBy) { continue; }
    // closest points of two segments (Ericson)
    let b = dot(u, v);
    let c = dot(v, v);
    let d = dot(u, w);
    let q = dot(v, w);
    let den = a * c - b * b;
    var s = select(0.5, clamp((b * q - c * d) / den, 0.0, 1.0), den > 1e-9);
    var t = (b * s + q) / c;
    if (t < 0.0) {
      t = 0.0;
      s = clamp(-d / a, 0.0, 1.0);
    } else if (t > 1.0) {
      t = 1.0;
      s = clamp((b - d) / a, 0.0, 1.0);
    }
    let gap = w + u * s - v * t;
    let dd = dot(gap, gap);
    if (dd >= reach * reach || dd < 1e-12) { continue; }
    let dist = sqrt(dd);
    let pen = min(reach - dist, push);
    let normal = gap / dist;
    let j = localOf(f);
    let w0 = wa * (1.0 - s);
    let w1 = wb * s;
    let w2 = weightOf(j) * (1.0 - t);
    let w3 = weightOf(j + 1) * t;
    let sum = w0 * (1.0 - s) + w1 * s + w2 * (1.0 - t) + w3 * t;
    if (sum < 1e-6) { continue; }
    // friction: undo sideways slip this substep, up to what the push allows
    let slipped = stepA * (1.0 - s) + stepB * s
      - (C - state[XP() + f].xyz) * (1.0 - t) - (D - state[XP() + f1].xyz) * t;
    var side = slipped - normal * dot(slipped, normal);
    let slip = length(side);
    side *= select(0.0, min(1.0, P.friction * pen / slip), slip > 1e-9);
    let impulse = (normal * pen - side) / max(sum, 0.25);
    toFirst += impulse * w0;
    toSecond += impulse * w1;
  }
  state[CA() + e] = vec4f(toFirst, 0.0);
  state[CB() + e] = vec4f(toSecond, 0.0);
}

@compute @workgroup_size(64)
fn applyContacts(@builtin(global_invocation_id) id: vec3u) {
  let g = id.x;
  if (g >= P.nodes) { return; }
  let change = state[CA() + g].xyz + state[CB() + previousOf(g)].xyz;
  state[X() + g] = vec4f(state[X() + g].xyz + change * P.relax, state[X() + g].w);
}

// ---- out to the renderer, in the same rows the bake fills: column 0 is the newest node

/** Hands one column to the renderer. The weave's count stays as it is: it repeats every K nodes */
fn show(col: u32, r: u32, n: i32, at: vec3f, facing: vec3f, squeezed: f32) {
  let o = (r * P.width + col) * 2u;
  var place = at;
  var face = facing;
  var squeeze = squeezed;
  if (P.keep != NONE) {
    kept[P.keep + o] = vec4f(at, 0.0);
    kept[P.keep + o + 1u] = vec4f(facing, squeezed);
  }
  if (P.blend != NONE) {
    let frame = kept[P.blend + o + 1u];
    place = mix(at, kept[P.blend + o].xyz, P.blendBy);
    squeeze = mix(squeezed, frame.w, P.blendBy);
    let turned = mix(facing, frame.xyz, P.blendBy);
    if (dot(turned, turned) > 1e-4) { face = normalize(turned); }
  }
  textureStore(nodeTexture, vec2u(col, r), vec4f(place, f32(n)));
  textureStore(frameTexture, vec2u(col, r), vec4f(face, squeeze));
}

/**
 * The rods are round, and a flat lace drawn on one is nearly twice as wide as it, so two that
 * touch as rods can cut through each other as ribbons. They'd do what real laces do: lie flat
 * against each other, and bunch up narrower where there isn't the room. This only changes how a
 * lace is drawn, never where it is, so the physics can't tell. Squeezed all the way it's as narrow
 * as the rod, and rods don't pass through each other.
 *
 * Runs once a frame, on the list of neighbours contacts already keep: its reach covers two laces
 * side by side.
 */
@compute @workgroup_size(64)
fn dress(@builtin(global_invocation_id) id: vec3u) {
  let e = id.x;
  if (e >= P.nodes) { return; }
  let i = localOf(e);
  if (i < 1 || i > i32(W) - 2 || !inContact(i)) {
    state[F() + e] = vec4f(0.0);
    return;
  }
  let wide = P.ribbon.x;
  let thin = P.ribbon.y;
  let t = state[T() + e].xyz;
  let facing = facingOf(e);
  let sideways = cross(t, facing);
  let was = state[E() + e];
  let flat = cos(was.x) * facing + sin(was.x) * sideways;
  let up = cross(t, flat);
  let width = mix(wide, 1.0, was.y);
  let middle = middleOf(e);

  // where the neighbours lie, as doubled angles: one either side of a lace agree instead of cancelling
  var lying = vec2f(0.0);
  var room = wide;
  let count = min(nearby[e * ROW], MAX_NEAR);
  for (var k = 1u; k <= count; k++) {
    let other = nearby[e * ROW + k];
    let q = middleOf(other) - middle;
    let along = dot(q, t);
    let level = 1.0 - smooth01(0.5 * P.spacing, 1.2 * P.spacing, abs(along));
    if (level <= 0.0) { continue; }
    let off = q - t * along;
    let x = dot(off, facing);
    let y = dot(off, sideways);
    let size = x * x + y * y + 1e-9;
    let close = level * (1.0 - smooth01(2.0 * P.radius, 2.0 * wide * P.radius, sqrt(size)));
    lying += close * vec2f(x * x - y * y, 2.0 * x * y) / size;

    let theirs = state[E() + other];
    let theirFlat = dressedFacing(other, theirs.x);
    let theirWidth = mix(wide, 1.0, theirs.y) - thin;
    let above = abs(dot(off, up)) / P.radius;
    let beside = abs(dot(off, flat)) / P.radius;
    let clear = 2.0 * thin + theirWidth * abs(dot(theirFlat, up));
    let clash = level * (1.0 - smooth01(0.9, 1.2, above / clear));
    let fair = beside * width / (width + thin + theirWidth * abs(dot(theirFlat, flat)));
    room = min(room, mix(wide, fair, clash));
  }

  // along the rope a ribbon turns and narrows gradually: it's one piece of cloth
  let g = e - e % W;
  let before = state[E() + g + (e + W - 1u) % W];
  let after = state[E() + g + (e + 1u) % W];
  var turn = mix(was.x, (before.x + after.x) * 0.5, 0.5);
  let sure = min(length(lying), 1.0);
  if (sure > 1e-3) {
    // the flat goes across the way the neighbours lie, by whichever way round is nearer
    let across = 0.5 * atan2(-lying.y, -lying.x);
    let half = TAU * 0.5;
    let aim = clamp(across + half * round((was.x - across) / half), -1.8, 1.8);
    turn += (aim - turn) * sure * P.ribbon.z;
  }
  turn -= turn * (1.0 - sure) * P.ribbon.z * 0.3;

  let wanted = max(clamp((wide - room) / (wide - 1.0), 0.0, 1.0), 0.6 * max(before.y, after.y));
  let speed = select(P.ribbon.w, min(P.ribbon.w * 6.0, 1.0), wanted > was.y);
  state[F() + e] = vec4f(turn, mix(was.y, wanted, speed), 0.0, 0.0);
}

@compute @workgroup_size(64)
fn publish(@builtin(global_invocation_id) id: vec3u) {
  let col = id.x;
  let r = id.y;
  if (col >= P.width) { return; }
  if (r == P.ropes) {
    if (col < P.ropes) {
      textureStore(nodeTexture, vec2u(col, r), vec4f(f32(topOf(col)) - headOf(col), 0.0, 0.0, 0.0));
    }
    return;
  }
  let j = topOf(r) - i32(col);
  let n = j + i32(P.rope[r].base); // the weave counts laid nodes from the very start, so a loop ending doesn't move it
  if (col >= W) {
    // from the past, or just after the start, while there's none yet, the oldest node over and over
    var at = state[pastOf(r, n)];
    var facing = state[pastOf(r, n) + 1u];
    if (n < 0 || at.w != f32(n)) {
      let oldest = nodeAt(r, topOf(r) - i32(W) + 1);
      at = state[X() + oldest];
      facing = vec4f(dressedFacing(oldest, state[E() + oldest].x), state[E() + oldest].y);
    }
    show(col, r, n, at.xyz - vec3f(P.scroll, 0.0, 0.0), facing.xyz, facing.w);
    return;
  }
  let g = nodeAt(r, j);
  let p = state[X() + g].xyz;
  if (P.remember != NONE) {
    let slot = lapSlot(r, j);
    var sample = p;
    if (P.mean != NONE) { sample = mix(kept[P.mean + slot].xyz, p, 0.5); }
    kept[P.remember + slot] = vec4f(sample, 0.0);
  }
  var dressed = vec4f(0.0);
  if (P.ribbon.x > 0.0) {
    dressed = state[F() + g];
    state[E() + g] = dressed;
  }
  var facing = dressedFacing(g, dressed.x);
  if (P.steady > 0.0) {
    // each node freed adds a little twist, and the solve spreads it down the rope in one step.
    // Which way a ribbon faces is only for show, so this is the one place a filter costs nothing
    let before = state[D() + g].xyz;
    if (dot(before, before) > 0.5) { facing = normalize(mix(before, facing, P.steady)); }
    state[D() + g] = vec4f(facing, 0.0);
  }
  show(col, r, n, p - vec3f(P.scroll, 0.0, 0.0), facing, dressed.y);
}
