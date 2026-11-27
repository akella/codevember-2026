// A tree of rays a pixel: at glass each ray goes on as two, the brighter at once and the other from a stack. All
// faces are flat and nothing is left to chance, so there is no noise. What the bolt gives is gathered along the way.

const BLADES = 14;
const BOXES = 6;
const LONG = 10; // coarse pieces of a bolt
const DEEP = 10; // rays put by, at most
const NEVER = 1e9;

struct Blade {
  ball: vec4f, // its middle and how far it reaches
  axis: vec4f, // the way it runs, and how many faces
  // its planes, four at a time and a component at a time: x, y, z of the normal, then how far out
  four: array<array<vec4f, 4>, 2>,
};
fn normalOf(i: i32, f: i32) -> vec3f {
  let k = f >> 2u;
  let c = f & 3;
  return vec3f(B[i].four[k][0][c], B[i].four[k][1][c], B[i].four[k][2][c]);
}
struct Bolt { // a bolt that is showing
  tree: vec4f, // its first node and the one after its last, then how far the leader has come and how bright it is
  fire: vec4f, // how far down the stroke coming up has got, how bright, how bright its branches, and where its channel's nodes end
};
struct Box { c: vec4f, u: vec4f, v: vec4f }; // a lamp: its middle and power, its halves across and up (and colour in the w's)
struct Scene {
  bolts: array<Bolt, 2>,
  shine: array<vec4f, 2>, // how bright each is on the whole
  box: array<Box, BOXES>,
  long: array<vec4f, 40>, // LONG * 2 of them, only those alight, first: from and how bright, to and 1 over its length squared
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<uniform> B: array<Blade, BLADES>;
@group(0) @binding(2) var<uniform> S: Scene;
@group(0) @binding(3) var<storage, read> nodes: array<vec4f>;
@group(0) @binding(4) var<storage, read> pieces: array<vec4f>;

@group(0) @binding(11) var noises: texture_2d<f32>;
@group(0) @binding(12) var rep: sampler;
// the bolts' light on the floor, a layer a bolt: what comes by way of glass, in its colours, and what comes straight
@group(0) @binding(14) var floors: texture_2d_array<f32>;
@group(0) @binding(15) var slant: sampler;
@group(0) @binding(5) var seen: texture_2d<f32>;
struct Marks { count: atomic<u32>, pad0: u32, pad1: u32, pad2: u32, at: array<u32> };
@group(0) @binding(6) var<storage, read_write> marks: Marks;
@group(0) @binding(7) var<storage, read_write> more: array<array<vec4f, 3>>;
@group(0) @binding(8) var<storage, read_write> asked: array<u32, 8>;
struct Marked { count: u32, pad0: u32, pad1: u32, pad2: u32, at: array<u32> };
@group(0) @binding(9) var<storage, read> listed: Marked;
@group(0) @binding(10) var<storage, read> found: array<array<vec4f, 3>>;

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

fn hash2(p: vec2f) -> f32 {
  let q = fract(p * vec2f(0.1031, 0.11369));
  let r = q + dot(q, q.yx + 19.19);
  return fract((r.x + r.y) * r.x);
}
// noise, 32 of its largest cells to a repeat: four octaves in x, one alone in y and in z
fn noise(p: vec2f, level: f32) -> vec3f { return textureSampleLevel(noises, rep, p / 32.0, level).xyz; }

var<private> tally: vec3f; // legs, boxes, pieces (for a look at the cost)

// ---- the bolt ----

// how near a ray comes to a piece: the distance, and where along the ray
fn near(o: vec3f, d: vec3f, a: vec3f, b: vec3f) -> vec2f {
  let e = b - a;
  let w = o - a;
  let ee = max(dot(e, e), 1e-9);
  let de = dot(d, e);
  let den = ee - de * de;
  var s = 0.0;
  if (den > 1e-9) { s = clamp((dot(w, e) - de * dot(w, d)) / den, 0.0, 1.0); }
  let q = a + e * s;
  let t = dot(q - o, d);
  return vec2f(length(o + d * t - q), t);
}

// the bolt's own light along a ray, from `from` before its start: (the hot core, the skin of light round it)
fn core(o: vec3f, d: vec3f, far: f32, before: f32, strong: f32) -> vec2f {
  let inv = 1.0 / select(d, vec3f(1e-7), abs(d) < vec3f(1e-7));
  var best = vec2f(0.0);
  for (var k = 0; k < 2; k++) {
    let bolt = S.bolts[k];
    if (bolt.fire.y + bolt.tree.w < 0.002) { continue; }
    var n = u32(bolt.tree.x);
    let end = u32(select(bolt.fire.w, bolt.tree.y, strong > P.tune.x));
    for (var guard = 0; guard < 600 && n < end; guard++) {
      tally.y += 1.0;
      let lo = nodes[n * 2u];
      let hi = nodes[n * 2u + 1u];
      let t0 = (lo.xyz - o) * inv;
      let t1 = (hi.xyz - o) * inv;
      let a = min(t0, t1);
      let b = max(t0, t1);
      let into = max(max(a.x, a.y), max(a.z, 0.0));
      let out = min(min(b.x, b.y), min(b.z, far));
      if (into > out) {
        n = u32(lo.w);
        continue;
      }
      if (hi.w >= 0.0) {
        let first = u32(hi.w) >> 3u;
        let many = u32(hi.w) & 7u;
        for (var i = first; i < first + many; i++) {
          tally.z += 1.0;
          let A = pieces[i * 2u];
          let Z = pieces[i * 2u + 1u];
          let g = near(o, d, A.xyz, Z.xyz);
          if (g.y < 0.0 || g.y > far) { continue; }
          let main = A.w > 0.0;
          let lum = abs(A.w);
          var glow = bolt.fire.y * smoothstep(bolt.fire.x - 0.04, bolt.fire.x + 0.02, Z.w) * select(bolt.fire.z * lum, 1.0, main);
          if (Z.w < bolt.tree.z) { glow += bolt.tree.w * select(lum * 1.5, 1.0, main) * (0.10 + exp((Z.w - bolt.tree.z) * 45.0)); }
          if (glow < 0.001) { continue; }
          let r = P.bolt.x * select(0.25 + 0.6 * sqrt(lum), 1.0, main);
          let px = (before + g.y) * P.size.z * 0.55;
          let w = sqrt(r * r + px * px);
          best.x = max(best.x, glow * exp(-g.x * g.x / (w * w)) * r / w);
          best.y = max(best.y, glow * exp(-g.x / (r * 3.5 + px)) * sqrt(lum));
        }
        n = u32(lo.w);
      } else {
        n = n + 1u;
      }
    }
  }
  return best;
}

// what the haze shows of it along a ray: mist throws light mostly forward, so a point
// passed at a distance d adds about 1/d^2, and a piece a difference of arctangents (1/d would make it asinhs)
fn haze(o: vec3f, d: vec3f, far: f32) -> f32 {
  var sum = 0.0;
  let many = i32(P.glow.z);
  for (var i = 0; i < many; i++) {
    let A = S.long[i * 2];
    let Z = S.long[i * 2 + 1].xyz;
    let wa = A.xyz - o;
    let wz = Z - o;
    let pa = wa - d * dot(wa, d);
    let e = (wz - d * dot(wz, d)) - pa;
    let l = max(length(e), 1e-4);
    let u = e / l;
    let t = -dot(pa, u);
    let off = sqrt(max(dot(pa, pa) - t * t, 0.0) + P.glow.y * P.glow.y);
    let mid = 0.5 * dot(wa + wz, d);
    let dm = length(0.5 * (pa + pa + e)) + P.glow.y;
    // (an arctangent of a sort: only to leave out what is behind the start or past the end)
    let y = vec2f(far - mid, mid) / dm;
    let part = dot(y * inverseSqrt(y * y + vec2f(1.0)), vec2f(0.5));
    sum += A.w * part * atan2(l * off, off * off - t * (l - t)) / off * length(Z - A.xyz) / l;
  }
  return sum;
}

// its light on a surface (either side of one, when `thin`)
// and what a wiped face, rough one way, throws of it toward `r`
fn lit(p: vec3f, n: vec3f, thin: bool, r: vec3f, across: vec3f) -> vec2f {
  var sum = 0.0;
  var sheen = 0.0;
  let s1 = 1.0 / P.dust.w;
  let many = i32(P.glow.z);
  for (var i = 0; i < many; i++) {
    let A = S.long[i * 2];
    let Z = S.long[i * 2 + 1].xyz;
    let e = Z - A.xyz;
    let k = clamp(dot(p - A.xyz, e) / dot(e, e), 0.2, 0.8);
    let v = A.xyz + e * k - p;
    let rr = dot(v, v) + 0.02;
    let c = dot(n, v) / sqrt(rr);
    if (thin) {
      // the nearest of it to the ray, and how far off that is: much less matters across the marks than along them
      let g = near(p, r, A.xyz, Z);
      if (g.y > 0.0) {
        let q = A.xyz + e * clamp(dot(p + r * g.y - A.xyz, e) / dot(e, e), 0.0, 1.0) - (p + r * g.y);
        let x = dot(q, across);
        let off = (dot(q, q) - 0.93 * x * x) / (g.y * g.y + 0.05);
        sheen += A.w * exp(-off * s1 * s1) / (1.0 + g.y);
      }
    }
    sum += A.w * length(e) * select(max(c, 0.0), abs(c), thin) / rr;
  }
  return vec2f(sum, sheen);
}

// ---- the room ----

fn back(d: vec3f) -> vec3f {
  let up = max(d.y, 0.0);
  let side = exp(-up * 5.0);
  return P.back.rgb * (0.25 + 0.75 * exp(-up * 1.8)) + P.back2.rgb * side * (0.4 + 0.6 * smoothstep(-0.9, 0.9, -d.z + 0.3 * d.x));
}

// the lamps of the studio, seen only in things
fn lamps(o: vec3f, d: vec3f) -> vec3f {
  var sum = vec3f(0.0);
  for (var i = 0; i < BOXES; i++) {
    let b = S.box[i];
    if (b.c.w <= 0.0) { continue; }
    let n = normalize(cross(b.u.xyz, b.v.xyz));
    let t = dot(b.c.xyz - o, n) / dot(d, n);
    if (t < 0.0) { continue; }
    let q = o + d * t - b.c.xyz;
    let x = dot(q, b.u.xyz) / dot(b.u.xyz, b.u.xyz);
    let y = dot(q, b.v.xyz) / dot(b.v.xyz, b.v.xyz);
    let soft = P.room.x;
    let m = smoothstep(1.0, 1.0 - soft, abs(x)) * smoothstep(1.0, 1.0 - soft, abs(y));
    let fall = 0.35 + 0.65 * (0.5 + 0.5 * y);
    sum += b.c.w * m * fall * mix(vec3f(1.0), vec3f(b.u.w, b.v.w, 1.0), 1.0);
  }
  return sum;
}

// ---- the glass ----

struct Hit { t: f32, blade: i32, face: i32 };

fn pick(v: vec4f, m: f32) -> i32 { return select(select(select(3, 2, v.z == m), 1, v.y == m), 0, v.x == m); }

fn glass(o: vec3f, d: vec3f, mask: u32, last: i32, lastFace: i32) -> Hit {
  var h = Hit(NEVER, -1, -1);
  let count = i32(P.room.y);
  for (var i = 0; i < count; i++) {
    let within = ((mask >> u32(i)) & 1u) == 1u;
    if (!within) {
      if (i == last) { continue; }
      let ball = B[i].ball;
      let m = ball.xyz - o;
      let along = dot(m, d);
      if (dot(m, m) - along * along > ball.w * ball.w || along < -ball.w || along - ball.w > h.t) { continue; }
    }
    let a0 = B[i].four[0];
    let b0 = B[i].four[1];
    let da = a0[0] * d.x + a0[1] * d.y + a0[2] * d.z;
    let db = b0[0] * d.x + b0[1] * d.y + b0[2] * d.z;
    let ta = (a0[3] - a0[0] * o.x - a0[1] * o.y - a0[2] * o.z) / da;
    let tb = (b0[3] - b0[0] * o.x - b0[1] * o.y - b0[2] * o.z) / db;
    if (within) {
      var va = select(vec4f(NEVER), max(ta, vec4f(0.0)), da > vec4f(1e-6));
      var vb = select(vec4f(NEVER), max(tb, vec4f(0.0)), db > vec4f(1e-6));
      if (i == last) {
        va = select(va, vec4f(NEVER), vec4i(0, 1, 2, 3) == vec4i(lastFace));
        vb = select(vb, vec4f(NEVER), vec4i(4, 5, 6, 7) == vec4i(lastFace));
      }
      let v = min(va, vb);
      let t = min(min(v.x, v.y), min(v.z, v.w));
      if (t < h.t) {
        let c = pick(v, t);
        h = Hit(t, i, select(c + 4, c, va[c] == t));
      }
    } else {
      let na = select(vec4f(-NEVER), ta, da < vec4f(0.0));
      let nb = select(vec4f(-NEVER), tb, db < vec4f(0.0));
      let fa = select(vec4f(NEVER), ta, da > vec4f(0.0));
      let fb = select(vec4f(NEVER), tb, db > vec4f(0.0));
      let n = max(na, nb);
      let f = min(fa, fb);
      let t0 = max(max(n.x, n.y), max(n.z, n.w));
      let t1 = min(min(f.x, f.y), min(f.z, f.w));
      if (t0 < t1 && t0 > 0.0 && t0 < h.t) {
        let c = pick(n, t0);
        h = Hit(t0, i, select(c + 4, c, na[c] == t0));
      }
    }
  }
  return h;
}

// how far a point of a face is from the nearest edge of it
fn toEdge(p: vec3f, i: i32, n: vec3f) -> f32 {
  var best = NEVER;
  for (var k = 0; k < 2; k++) {
    let q = B[i].four[k];
    let c = q[0] * n.x + q[1] * n.y + q[2] * n.z;
    let t = (q[3] - q[0] * p.x - q[1] * p.y - q[2] * p.z) * inverseSqrt(max(vec4f(1.0) - c * c, vec4f(1e-4)));
    let v = select(t, vec4f(NEVER), c > vec4f(0.9999));
    best = min(best, min(min(v.x, v.y), min(v.z, v.w)));
  }
  return max(best, 0.0);
}

fn fresnel(c: f32, eta: f32) -> f32 { // eta: from over to
  let s2 = eta * eta * (1.0 - c * c);
  if (s2 >= 1.0) { return 1.0; }
  let ct = sqrt(1.0 - s2);
  let a = (eta * c - ct) / (eta * c + ct);
  let b = (c - eta * ct) / (c + eta * ct);
  return 0.5 * (a * a + b * b);
}

// ---- the floor ----

struct Floor { n: vec3f, rough: f32, tone: f32, wet: f32 };
fn ground(p: vec2f, px: f32) -> Floor {
  let turn = mat2x2f(P.tile.y, P.tile.z, -P.tile.z, P.tile.y);
  let q = turn * p / P.tile.x;
  let id = floor(q);
  let f = abs(fract(q) - 0.5);
  let seam = (0.5 - max(f.x, f.y)) * P.tile.x;
  let line = 1.0 - smoothstep(P.tile.w - px * 0.7, P.tile.w + px * 0.7, seam);
  let line2 = line * min(1.0, 2.0 * P.tile.w / px);
  let tilt = (vec2f(hash2(id + 3.1), hash2(id + 17.7)) - 0.5) * P.floor.w;
  let pool = noise(p * 0.35 + 4.0, log2(px * 6.0)).x;
  let fine = noise(p * 3.0 + 20.0, log2(px * 48.0)).x;
  let dry = smoothstep(0.35, 0.65, pool * 0.75 + fine * 0.3);
  var g: Floor;
  let wave = (noise(p * 1.3, log2(px * 20.0)).yz - 0.5) * P.floor.w * 0.5;
  g.n = normalize(vec3f(tilt.x + wave.x, 1.0, tilt.y + wave.y));
  g.rough = mix(P.floor.y, P.floor.z, dry) + line2 * 0.1;
  g.wet = (1.0 - 0.75 * line2) * mix(1.0, 0.72, dry);
  g.tone = (0.6 + 0.8 * fine) * (1.0 - 0.8 * line2);
  return g;
}

// ---- all of it ----

struct Out {
  @location(0) seen: vec4f, // what is seen outright (and how far off the first thing is)
  @location(1) mirrored: vec4f, // what the floor mirrors there, unblurred; 1 where it is the floor
  @location(2) aux: vec4f, // how far off what it mirrors is, how strongly, how roughly, how far to the floor
};

fn pixel(at: vec2f) -> Out {
  var out: Out;
  var name = 0; // of what the ray met first, to tell neighbours apart
  let uv = (at / P.size.xy * 2.0 - 1.0) * vec2f(1.0, -1.0);
  var o = P.eye.xyz;
  var d = normalize(P.fore.xyz + P.right.xyz * uv.x + P.up.xyz * uv.y);
  let first = d;
  var mask = 0u;
  var last = -1;
  var face = -1;
  var thr = vec3f(1.0);
  var been = 0.0;
  var depth = 0;
  var mirror = false; // has been turned back by something, so it may see the lamps
  var sum = vec3f(0.0);
  var onFloor = false;
  var plain = vec3f(0.0); // what was seen before the floor took over
  var away = vec2f(0.0); // light times distance, and light
  var floorT = 0.0;

  var so: array<vec4f, DEEP>;
  var sd: array<vec4f, DEEP>;
  var st: array<vec4f, DEEP>;
  var si: array<vec4i, DEEP>;
  var top = 0;
  let most = i32(P.room.z);
  let cut = P.room.w;
  let ior = P.glass.x;

  for (var step = 0; step < most; step++) {
    tally.x += 1.0;
    var h = glass(o, d, mask, last, face);
    let inside = mask != 0u;
    var far = h.t;
    var what = select(0, 1, h.blade >= 0);
    if (!inside && d.y < -1e-5) {
      let t = -o.y / d.y;
      if (t > 1e-4 && t < far) { far = t; what = 2; }
    }
    let reach = min(far, 80.0);
    var got = vec3f(0.0);
    // the bolt along the way
    let c = core(o, d, reach, been, max(thr.x, thr.z));
    got += P.hot.rgb * c.x + P.skin.rgb * c.y;
    if (inside) {
      let soak = exp(-P.tint.rgb * reach);
      got *= sqrt(soak);
      sum += thr * got;
      away += dot(thr * got, vec3f(1.0)) * vec2f(been - floorT + reach * 0.5, 1.0);
      thr *= soak;
    } else {
      if (P.glow.x > 0.0 && depth < 4 && max(thr.x, thr.z) > P.tune.y) { got += P.haze.rgb * haze(o, d, reach); }
      sum += thr * got;
      away += dot(thr * got, vec3f(1.0)) * vec2f(been - floorT + min(reach, 12.0) * 0.5, 1.0);
    }
    if (onFloor && away.y == 0.0) { away = vec2f(min(reach, 14.0), 1.0) * 0.004; } // (so that where it is all but dark there is a distance too)
    been += reach;
    var go = false; // does this ray go on
    if (step < 2 && !onFloor) {
      name = (name * 7 + select(0, (h.blade + 1) * 13 + h.face + 1, what == 1) + select(0, 5, what == 2)) % 1021;
    }

    let p = o + d * far;
    var n = vec3f(0.0, 1.0, 0.0);
    var across = vec3f(1.0, 0.0, 0.0);
    var ends = false; // between two blades that overlap there is no face
    if (what == 1) {
      n = normalOf(h.blade, h.face);
      ends = mask != 0u && (mask ^ (1u << u32(h.blade))) != 0u;
      if (inside) { n = -n; }
      across = normalize(cross(n, B[h.blade].axis.xyz));
    }
    var gets = vec2f(0.0);
    var mapped = 0.0; // a place on the floor that the maps of its light cover
    if (what == 2) {
      let q = abs(p.xz) / P.maps.x;
      mapped = smoothstep(1.0, 0.8, max(q.x, q.y));
    }
    if (what != 0 && !ends && mapped < 1.0 && max(thr.x, thr.z) > P.tune.z) { gets = lit(p, n, what == 1, reflect(d, n), across); }

    if (what == 0) {
      var sky = back(d);
      if (mirror) { sky += lamps(o, d); }
      sum += thr * sky;
      away += dot(thr * sky, vec3f(1.0)) * vec2f(been - floorT, 1.0);
    } else if (what == 2) {
      let px = been * P.size.z / max(-d.y, 0.05);
      let g = ground(p.xz, px);
      let fog = exp(-been * P.back.w);
      var light = gets.x * (1.0 - mapped) * P.lit.rgb + P.lamp.rgb * 0.02;
      if (mapped > 0.0) {
        let at = p.xz / P.maps.x * 0.5 + 0.5;
        let flat = normalize(d.xz);
        let s1 = vec2f(-flat.y, flat.x) * been * P.size.z / P.maps.x * 0.5;
        let s2 = flat * px / P.maps.x * 0.5;
        for (var k = 0; k < 2; k++) {
          let much = S.shine[k].x;
          if (much < 0.002) { continue; }
          let m = textureSampleGrad(floors, slant, at, i32(select(P.maps.y, P.maps.z, k == 1)), s1, s2);
          light += mapped * much * (m.a * P.lit.rgb + m.rgb * pow(max(m.g, 1e-4) * 8.0, P.maps.w - 1.0) * P.thrown.rgb);
        }
      }
      sum += thr * (light * P.floor.x * g.tone * fog + back(normalize(vec3f(d.x, 0.0, d.z))) * (1.0 - fog));
      let cosi = max(-d.y, 0.0);
      let f = (P.lamp.w + (1.0 - P.lamp.w) * pow(1.0 - cosi, 5.0)) * g.wet * fog;
      let r = reflect(d, g.n);
      if (depth == 0) {
        // from here on it is the floor's picture that is drawn, and left to be blurred
        onFloor = true;
        plain = sum;
        sum = vec3f(0.0);
        away = vec2f(0.0);
        floorT = been;
        out.aux = vec4f(0.0, f, g.rough, been);
        // (one pixel in four: it is blurred anyway)
        if (((u32(at.x) | u32(at.y)) & 1u) == 1u) {
          out.seen = vec4f(plain, f32(name));
          out.mirrored = vec4f(0.0);
          return out;
        }
      } else {
        thr *= f;
      }
      o = p;
      d = normalize(vec3f(r.x, abs(r.y), r.z));
      last = -1;
      face = -1;
      mirror = true;
      go = true;
    } else {
      let bit = 1u << u32(h.blade);
      let to = mask ^ bit;
      if (ends) {
        // from one blade into another: all one glass
        o = p;
        mask = to;
        last = h.blade;
        face = h.face;
        go = true;
      } else {
        let eta = select(1.0 / ior, ior, inside);
        // the edges are ground, and catch light
        let px = been * P.size.z;
        let e = toEdge(p, h.blade, select(n, -n, inside));
        let bevel = P.glass.z;
        let cover = clamp((bevel + 0.5 * px - e) / px, 0.0, 1.0) * min(1.0, 2.0 * bevel / px + 0.15);
        // dust and wipe marks on the faces, long along the blade
        let ax = B[h.blade].axis.xyz;
        let bx = across;
        let fuv = vec2f(dot(p, ax), dot(p, bx)) + f32(h.blade) * 3.7 + f32(h.face) * 1.9;
        let smear = noise(fuv * vec2f(0.8, 5.0), log2(been * P.size.z * 80.0)).x;
        let marks = smoothstep(0.45, 0.8, smear);
        let dust = P.dust.x * (0.25 + 1.6 * marks);
        if (max(thr.x, thr.z) > P.tune.z) {
          let near = gets.x;
          sum += thr * (P.lit.rgb * near * (dust + cover * P.glass.w) + P.sheen.rgb * gets.y * (0.015 + 0.25 * marks * marks));
          sum += thr * P.lamp.rgb * cover * P.dust.y * (0.3 + 0.7 * abs(n.y));
          away += dot(thr * P.lit.rgb * near * (dust + cover * P.glass.w), vec3f(1.0)) * vec2f(been - floorT, 1.0);
        }
        // the wiped places hold a little of the lamps' light too
        let key = abs(dot(n, vec3f(0.35, 0.8, 0.48)));
        sum += thr * P.lamp.rgb * P.tune.w * (0.12 + marks) * (0.15 + key * key);
        thr *= 1.0 - 0.75 * cover;
        // the faces are not quite flat
        let bend = (noise(fuv * vec2f(0.5, 1.7), 0.0).yz - 0.5) * P.dust.z;
        let nb = normalize(n + ax * bend.x + bx * bend.y);
        let cb = max(dot(-d, nb), 1e-4);
        var f = fresnel(cb, eta);
        if (!inside) { f = f + (1.0 - f) * P.glass.y * (0.6 + 0.8 * marks); }
        let into = refract(d, nb, eta);
        let back = reflect(d, nb);
        let turned = dot(into, into) < 0.5;
        if (turned) { f = 1.0; }
        var rd = back;
        if (dot(rd, n) < 1e-4) { rd = normalize(rd + n * (1e-3 - dot(rd, n))); }
        let tr = thr * f;
        let tt = thr * (1.0 - f);
        let big = f > 0.5;
        // the brighter goes on now, the other waits
        let wr = max(tr.x, max(tr.y, tr.z));
        let wt = max(tt.x, max(tt.y, tt.z));
        if (big) {
          if (wt > cut && top < DEEP) {
            so[top] = vec4f(p, been); sd[top] = vec4f(into, 0.0); st[top] = vec4f(tt, 0.0);
            si[top] = vec4i(i32(to), h.blade, h.face, (depth + 1) * 2 + select(0, 1, mirror));
            top++;
          }
          d = rd; thr = tr; mirror = true;
        } else {
          if (wr > cut && top < DEEP) {
            so[top] = vec4f(p, been); sd[top] = vec4f(rd, 0.0); st[top] = vec4f(tr, 0.0);
            si[top] = vec4i(i32(mask), h.blade, h.face, (depth + 1) * 2 + 1);
            top++;
          }
          d = into; thr = tt; mask = to;
        }
        o = p;
        last = h.blade;
        face = h.face;
        go = true;
      }
    }
    depth++;
    if (go && max(thr.x, max(thr.y, thr.z)) < cut) { go = false; }
    if (!go) {
      if (top == 0) { break; }
      top--;
      o = so[top].xyz;
      been = so[top].w;
      d = sd[top].xyz;
      thr = st[top].xyz;
      mask = u32(si[top].x);
      last = si[top].y;
      face = si[top].z;
      depth = si[top].w >> 1u;
      mirror = (si[top].w & 1) == 1;
    }
  }
  if (P.eye.w > 1.5) {
    out.seen = vec4f(tally / vec3f(26.0, 600.0, 200.0), 1.0);
    out.mirrored = vec4f(0.0);
    out.aux = vec4f(0.0);
    return out;
  }
  if (onFloor) {
    out.seen = vec4f(plain, f32(name));
    out.mirrored = vec4f(min(sum, vec3f(60.0)), 1.0);
    out.aux.x = away.x / max(away.y, 1e-5);
  } else {
    out.seen = vec4f(min(sum, vec3f(200.0)), f32(name));
    out.mirrored = vec4f(0.0);
    out.aux = vec4f(0.0);
  }
  return out;
}

@fragment
fn frag(@builtin(position) at: vec4f) -> Out { return pixel(at.xy); }

// ---- more rays where edges are ----

@compute @workgroup_size(8, 8)
fn gather(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2u(P.size.xy);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let hi = vec2i(size) - 1;
  let mid = textureLoad(seen, p, 0);
  var edge = false;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(select(0, select(-1, 1, k == 1), k < 2), select(0, select(-1, 1, k == 3), k > 1));
    if (textureLoad(seen, clamp(p + o, vec2i(0), hi), 0).a != mid.a) { edge = true; }
  }
  if (edge) {
    let i = atomicAdd(&marks.count, 1u);
    if (i < arrayLength(&marks.at)) { marks.at[i] = id.x | (id.y << 16u); }
  }
}
@compute @workgroup_size(1)
fn count() {
  let n = min(atomicLoad(&marks.count), arrayLength(&marks.at));
  asked[0] = (n + 63u) / 64u;
  asked[1] = 1u;
  asked[2] = 1u;
  asked[4] = n;
  asked[5] = 1u;
  asked[6] = u32(P.size.x) * 0u;
  asked[7] = 0u;
}
@compute @workgroup_size(64)
fn mend(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= min(atomicLoad(&marks.count), arrayLength(&marks.at))) { return; }
  let m = marks.at[id.x];
  let p = vec2f(f32(m & 0xffffu), f32(m >> 16u)) + 0.5;
  let n = i32(P.sheen.w);
  var a = vec4f(0.0);
  var b = vec4f(0.0);
  var c = vec4f(0.0);
  for (var i = 0; i < n; i++) {
    let x = fract(0.5 + f32(i + 1) * vec2f(0.7548777, 0.5698403));
    let o = pixel(p + x - 0.5);
    a += o.seen;
    b += o.mirrored;
    c += o.aux;
  }
  more[id.x] = array<vec4f, 3>(a / f32(n), b / f32(n), c / f32(n));
}
struct Spot { @builtin(position) at: vec4f, @location(0) @interpolate(flat, either) i: u32 };
@vertex
fn spot(@builtin(vertex_index) i: u32) -> Spot {
  let m = listed.at[i];
  let p = (vec2f(f32(m & 0xffffu), f32(m >> 16u)) + 0.5) / P.size.xy * 2.0 - 1.0;
  return Spot(vec4f(p.x, -p.y, 0.0, 1.0), i);
}
@fragment
fn blend(s: Spot) -> Out {
  let f = found[s.i];
  return Out(f[0], f[1], f[2]);
}

// ---- the light on the floor, worked out once for each bolt ----

struct Bake {
  turn: u32, // which lot of photons this is
  size: u32, // of the map
  each: f32, // what a photon is worth, over a texel's area
  power: f32, // the whole bolt's
  bends: f32, // of a colour from the next: how far the glass's index goes from one end to the other
  ripple: f32, // how uneven the faces are to this light
  wide: f32, // of a hot place
  many: f32, // of them
  hot: array<vec4f, 12>, // where the bolt touches glass, and how strong there
};
@group(0) @binding(16) var<uniform> K: Bake;
@group(0) @binding(17) var<storage, read_write> tallied: array<atomic<u32>>;
@group(0) @binding(18) var made: texture_storage_2d<rgba16float, write>;
@group(0) @binding(19) var<storage, read> done: array<u32>;
@group(0) @binding(20) var sharp: texture_2d<f32>;

fn scramble(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn unit01(v: u32) -> f32 { return f32(v >> 8u) / 16777216.0; }

fn insideOf(p: vec3f) -> u32 {
  var mask = 0u;
  for (var i = 0; i < i32(P.room.y); i++) {
    var all = true;
    for (var k = 0; k < 2; k++) {
      let q = B[i].four[k];
      if (any(q[0] * p.x + q[1] * p.y + q[2] * p.z > q[3])) { all = false; }
    }
    if (all) { mask |= 1u << u32(i); }
  }
  return mask;
}

@compute @workgroup_size(64)
fn photons(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x + K.turn * 1048576u;
  var seed = scramble(index ^ 0x5bd1e995u);
  // (spread evenly over where they start, which way they go and what colour they are)
  let hot = K.hot[min(u32(unit01(index * 3679390609u) * K.many), u32(K.many) - 1u)];
  let z = unit01(index * 2700274805u) * 2.0 - 1.0;
  let turn = unit01(index * 2313257605u) * 6.2831853;
  let r = sqrt(max(1.0 - z * z, 0.0));
  var d = vec3f(r * cos(turn), z, r * sin(turn));
  let j0 = scramble(seed + 1u);
  let j1 = scramble(j0);
  let j2 = scramble(j1);
  var o = hot.xyz + (vec3f(unit01(j0), unit01(j1), unit01(j2)) * 2.0 - 1.0) * K.wide;
  o.y = max(o.y, 0.02);
  let hue = unit01(index * 3152041523u);
  let ior = P.glass.x + (hue - 0.5) * K.bends;
  let colour = max(vec3f(1.0 - 2.0 * hue, 1.0 - abs(2.0 * hue - 1.0), 2.0 * hue - 1.0), vec3f(0.0)) * vec3f(4.0, 2.0, 4.0);
  var mask = insideOf(o);
  var last = -1;
  var face = -1;
  var w = hot.w;
  var met = 0;
  for (var step = 0; step < 14; step++) {
    let h = glass(o, d, mask, last, face);
    let inside = mask != 0u;
    if (!inside && d.y < -1e-5 && -o.y / d.y < h.t) {
      if (met == 0) { return; }
      let p = o + d * (-o.y / d.y);
      let at = (p.xz / P.maps.x * 0.5 + 0.5) * f32(K.size);
      if (any(at < vec2f(0.0)) || any(at >= vec2f(f32(K.size)))) { return; }
      let q = vec2u(at);
      let i = (q.y * K.size + q.x) * 4u;
      atomicAdd(&tallied[i], u32(w * 256.0 * colour.x));
      atomicAdd(&tallied[i + 1u], u32(w * 256.0 * colour.y));
      atomicAdd(&tallied[i + 2u], u32(w * 256.0 * colour.z));
      atomicAdd(&tallied[i + 3u], 256u);
      return;
    }
    if (h.blade < 0) { return; }
    if (inside) { w *= exp(-dot(P.tint.rgb, vec3f(0.333)) * h.t); }
    if (w < 0.01) { return; }
    o = o + d * h.t;
    last = h.blade;
    face = h.face;
    let to = mask ^ (1u << u32(h.blade));
    if (mask != 0u && to != 0u) {
      mask = to;
      continue;
    }
    met++;
    var n = normalOf(h.blade, h.face);
    if (inside) { n = -n; }
    let ax = B[h.blade].axis.xyz;
    let bx = normalize(cross(n, ax));
    let fuv = vec2f(dot(o, ax), dot(o, bx)) + f32(h.blade) * 3.7 + f32(h.face) * 1.9;
    let bend = (noise(fuv * vec2f(0.5, 1.7), 0.0).yz - 0.5) * P.dust.z + (noise(fuv * vec2f(0.7, 1.3) + 5.0, 1.0).yz - 0.5) * K.ripple;
    let nb = normalize(n + ax * bend.x + bx * bend.y);
    let eta = select(1.0 / ior, ior, inside);
    var f = fresnel(max(dot(-d, nb), 1e-4), eta);
    if (!inside) { f = f + (1.0 - f) * P.glass.y; }
    let into = refract(d, nb, eta);
    seed = scramble(seed);
    if (dot(into, into) < 0.5 || unit01(seed) < f) {
      d = reflect(d, nb);
      if (dot(d, n) < 1e-4) { d = normalize(d + n * (1e-3 - dot(d, n))); }
    } else {
      d = into;
      mask = to;
    }
  }
}

// the photons of each texel and as many round it as it takes to be sure
@compute @workgroup_size(8, 8)
fn settle(@builtin(global_invocation_id) id: vec3u) {
  let size = i32(K.size);
  let p = vec2i(id.xy);
  if (p.x >= size || p.y >= size) { return; }
  var sum = vec4f(0.0);
  var area = 0.0;
  for (var r = 0; r <= 9; r++) {
    for (var y = -r; y <= r; y++) {
      for (var x = -r; x <= r; x++) {
        if (max(abs(x), abs(y)) != r || x * x + y * y > r * r + r) { continue; }
        let q = p + vec2i(x, y);
        if (any(q < vec2i(0)) || any(q >= vec2i(size))) { continue; }
        let i = u32(q.y * size + q.x) * 4u;
        sum += vec4f(f32(done[i]), f32(done[i + 1u]), f32(done[i + 2u]), f32(done[i + 3u])) / 256.0;
        area += 1.0;
      }
    }
    if (r > 0 && sum.a > 60.0) { break; }
  }
  // (nothing so hot that it is all one sees)
  textureStore(made, p, vec4f(min(sum.rgb / area * K.each, vec3f(2.2)), textureLoad(sharp, p, 0).r));
}

// what comes to the floor with no glass in the way
@compute @workgroup_size(8, 8)
fn open(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2u(id.xy);
  if (p.x >= K.size || p.y >= K.size) { return; }
  var seed = scramble(p.x + p.y * K.size);
  let o = vec3f((f32(p.x) + 0.5) / f32(K.size) * 2.0 - 1.0, 0.0, (f32(p.y) + 0.5) / f32(K.size) * 2.0 - 1.0) * P.maps.x + vec3f(0.0, 1e-3, 0.0);
  var sum = 0.0;
  let each = 24u;
  for (var i = 0u; i < u32(K.many) * each; i++) {
    let hot = K.hot[i / each];
    let j1 = scramble(seed);
    let j2 = scramble(j1);
    seed = scramble(j2);
    let at = hot.xyz + (vec3f(unit01(j1), unit01(j2), unit01(seed)) * 2.0 - 1.0) * K.wide;
    let v = vec3f(at.x, max(at.y, 0.02), at.z) - o;
    let rr = dot(v, v);
    let d = v / sqrt(rr);
    let h = glass(o, d, 0u, -1, -1);
    if (h.t * h.t < rr) { continue; }
    sum += hot.w * max(d.y, 0.0) / (rr + 0.03);
  }
  textureStore(made, p, vec4f(sum * K.power / (K.many * f32(each))));
}
