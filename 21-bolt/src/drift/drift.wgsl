// Clouds going by on the wind that, for a while, from here, are a head; bolts through them, over the sea. As collage.wgsl,
// but nothing is stamped into a block: each cloud is looked up in its own VDB where it is now (an atlas of all ten),
// and only the light is worked out in a block, which goes with the wind, from a coarse copy made every frame.

struct Params {
  size: vec4f, // of the picture marched, radians a pixel, time
  eye: vec4f,
  right: vec4f,
  up: vec4f,
  fore: vec4f,
  box: vec4f, // half the cloud's box, and a voxel
  thick: vec4f, // extinction at density 1; how much of that turns light aside; a step; how deep the picked-out detail is
  fray: vec4f, // how much finer stuff eats the edges, its size, how far it has drifted; how much fine shade
  moon: vec4f, // the way to it
  moonTone: vec4f,
  skyTone: vec4f,
  wire: vec4f, // how wide a bolt is, how bright its branches, its halo's width, how bright its core
  more: vec4f, // the picture's size, full, radians a pixel; how bright the halo
  hot: vec4f, // how white the core is; the finest level there is
  sea: vec4f, // how high the water is, how rough, the time, how much of what is above it gives back
  seaMore: vec4f, // its own colour; 1 if it is there
  drift: vec4f, // how far the wind has taken the block the light is in; how many clouds there are
  flare: array<vec4f, 18>, // each bolt seen from further off: a line from a to b; its colour, how bright
  reach: vec4f, // how far that light goes before it is a half; how bright all of them are
  lamp: vec4f, // the lighthouse's lamp: where; which way its beam is turned
  house: vec4f, // how bright the lamp is, its beam in the air, how narrow that is (1 - cos); how much the bolts light the house
  place: vec4f, // where the house stands, and its size (it is in metres)
  houseMore: vec4f, // 1 if it is there; how much the beam lights the clouds; how much a strike lights the sky
  rain: vec4f, // how much; how high it falls from; how many times its streaks fall through in a loop; how slanted by the wind
  haze: vec4f, // how thick the air is; from how far off it shows
  far: array<vec4f, 4>, // strikes far off, below the horizon: which way across (radians), how high their glow goes, how bright
  farTone: vec4f,
  cut: vec4f, // how little light gets through for a ray to stop; how much longer the steps are in the water's picture
  opt: vec4f, // 1: only the clouds a ray is in are looked in at a step; 1: the rain's cover from its map; 1: the bolts' cover worked out once a piece
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var lin: sampler;
@group(0) @binding(2) var coarse: texture_3d<f32>; // all of them, coarsely, in the light's block
@group(0) @binding(3) var atlas: texture_3d<f32>; // the ten clouds, side by side
@group(0) @binding(6) var atlasMost: texture_3d<f32>; // the most in each 8 voxels of it, and round them
@group(0) @binding(11) var atlasMean: texture_3d<f32>; // the mean of each 4
struct Lump {
  m0: vec4f, // from the world straight to where in the atlas
  m1: vec4f,
  m2: vec4f,
  lo: vec4f, // its part of the atlas; how strong it is (with the most its picture means)
  hi: vec4f, // and how worn its base is
  x: vec4f, // its own axes, as the world's
  y: vec4f,
  z: vec4f,
  at: vec4f, // its middle, and how large
  half: vec4f, // half of it at size 1
};
@group(0) @binding(12) var<storage, read> lumps: array<Lump>;
@group(0) @binding(4) var still: texture_3d<f32>; // the moon's light, the sky's
@group(0) @binding(5) var glow: texture_3d<f32>; // the light of the bolts, and how much that is
@group(0) @binding(7) var grain: texture_3d<f32>;
@group(0) @binding(8) var rep: sampler;

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}
fn place(p: vec3f) -> vec3f { return p / P.box.xyz * 0.5 + 0.5; }
// (p of the world, in the block the light is in)
fn local(p: vec3f) -> vec3f { return p - P.drift.xyz; }
fn inBlock(p: vec3f) -> f32 { let e = P.box.xyz - abs(p); return smoothstep(0.0, 0.6, min(e.x, e.z)) * smoothstep(0.0, 0.25, e.y); } // (a wide blend to the light out of it, or a cloud going over the edge seems to change)
// coarsely, of a point in the light's block
fn density(p: vec3f) -> f32 {
  let v = textureSampleLevel(coarse, lin, place(p), 0.0).r;
  return v * v;
}

// which clouds a ray goes through, and from where to where
var<private> mask: vec2u; // (one bit a cloud: 64 of them)
// (mask: all it goes through from there on; act: those it is in, there; next: how far on that changes)
struct Hits { mask: vec2u, act: vec2u, near: f32, far: f32, next: f32 };
// (counting the work, when asked: what each pixel of the march did, added up over the picture)
@group(0) @binding(42) var<storage, read_write> counts: array<atomic<u32>, 16>;
var<private> cnt: array<u32, 16>;
var<private> cphase: u32; // (0: the march, 1: in the water, 2: the fine shade)
// (which may be met at all: for a ray from the eye, those that can be seen in its tile of the picture; else all)
var<private> pool: vec2u;
@group(0) @binding(41) var<storage, read> tiles: array<vec2u>;
fn everyLump() -> vec2u {
  let n = u32(P.drift.w);
  return vec2u(select((1u << min(n, 31u)) - 1u, 0xffffffffu, n >= 32u), select(0u, (1u << (n - 32u)) - 1u, n > 32u) | select(0u, 0xffffffffu, n >= 64u));
}
fn hits(o: vec3f, d: vec3f, past: f32) -> Hits {
  var out = Hits(vec2u(0u), vec2u(0u), 1e9, 0.0, 1e9);
  var m = pool;
  loop {
    var i = 0u;
    if (m.x != 0u) {
      i = firstTrailingBit(m.x);
      m.x &= m.x - 1u;
    } else if (m.y != 0u) {
      i = 32u + firstTrailingBit(m.y);
      m.y &= m.y - 1u;
    } else { break; }
    let L = lumps[i];
    cnt[13] += 1u;
    let r = L.half.xyz * L.at.w;
    let q = o - L.at.xyz;
    let a = vec3f(dot(q, L.x.xyz), dot(q, L.y.xyz), dot(q, L.z.xyz)) / r;
    let b = vec3f(dot(d, L.x.xyz), dot(d, L.y.xyz), dot(d, L.z.xyz)) / r;
    let inv = 1.0 / select(b, vec3f(1e-6), abs(b) < vec3f(1e-6));
    let lo = min((-1.0 - a) * inv, (1.0 - a) * inv);
    let hi = max((-1.0 - a) * inv, (1.0 - a) * inv);
    let enter = max(lo.x, max(lo.y, lo.z));
    let t0 = max(enter, past);
    let t1 = min(hi.x, min(hi.y, hi.z));
    if (t1 > t0) {
      let bit = select(vec2u(0u, 1u << (i & 31u)), vec2u(1u << i, 0u), i < 32u);
      out.mask |= bit;
      out.near = min(out.near, t0);
      out.far = max(out.far, t1);
      if (enter <= past) {
        out.act |= bit;
        out.next = min(out.next, t1);
      } else {
        out.next = min(out.next, enter);
      }
    }
  }
  return out;
}
// where in the atlas a point is, of a cloud
fn inAtlas(L: Lump, p: vec3f) -> vec3f {
  let q = vec4f(p, 1.0);
  return vec3f(dot(L.m0, q), dot(L.m1, q), dot(L.m2, q));
}
fn inside(L: Lump, a: vec3f) -> bool { return all(a >= L.lo.xyz) && all(a <= L.hi.xyz); }
// the most of the clouds the ray goes through, here: (how dense, whether any may be near, whether p is in any box)
var<private> which: u32; // (the densest there, last asked)
// how far it is, at the least, from where last asked to any cloud that is there (worked out once, at load: atlasFar)
@group(0) @binding(43) var atlasFar: texture_3d<f32>; // (in twos of voxels each way: how many twos away the nearest cloud is)
const SOURCE = 0.02; // (a voxel of the clouds at size 1)
var<private> gap: f32;
fn sampleAt(p: vec3f, ragged: bool) -> vec3f {
  var out = vec3f(0.0);
  gap = 1e3;
  var m = mask;
  loop {
    var i = 0u;
    if (m.x != 0u) {
      i = firstTrailingBit(m.x);
      m.x &= m.x - 1u;
    } else if (m.y != 0u) {
      i = 32u + firstTrailingBit(m.y);
      m.y &= m.y - 1u;
    } else { break; }
    let L = lumps[i];
    let a = inAtlas(L, p);
    if (!inside(L, a)) {
      // (not in its box yet, or no longer: it is at least this far)
      let o = max(max(L.lo.xyz - a, a - L.hi.xyz), vec3f(0.0)) * vec3f(textureDimensions(atlas));
      gap = min(gap, max(o.x, max(o.y, o.z)) * SOURCE * L.at.w);
      continue;
    }
    out.z = 1.0;
    // (how far the nearest of it is: two cells or more, and nothing here can be seen)
    let far = textureLoad(atlasFar, vec3i(a * vec3f(textureDimensions(atlasFar))), 0).r * 255.0;
    cnt[15] += 1u;
    if (far >= 2.0 && P.cut.w >= 0.0) { // (jump -1: as if there were none, to compare)
      gap = min(gap, (far - 1.0) * 2.0 * SOURCE * L.at.w);
      continue;
    }
    gap = 0.0;
    let most = textureSampleLevel(atlasMost, lin, a, 0.0).r * L.lo.w;
    cnt[6u + cphase * 2u] += 1u;
    if (most < 0.004 || most <= out.x) { continue; } // (none there, or none that can be denser than what is found)
    out.y = max(out.y, most);
    let v = textureSampleLevel(atlas, lin, a, 0.0).r;
    cnt[7u + cphase * 2u] += 1u;
    var d = v * v * L.lo.w;
    let u = (a - L.lo.xyz) / (L.hi.xyz - L.lo.xyz);
    if (ragged && L.hi.w > 0.0 && u.y < L.hi.w * 1.5) {
      // (its flat base worn ragged, by billows coming up from below)
      let n = textureSampleLevel(grain, rep, u * L.half.xyz * 2.0 * L.at.w * 1.3 + L.half.w * 0.37, 0.0);
      d *= smoothstep(0.0, 0.25, u.y - L.hi.w * (1.4 * n.x + 0.6 * n.y - 0.75));
    }
    if (ragged && d >= 0.002) {
      // (its edges eaten into, by noise that is its own: it goes and turns with it, not with the block the light is in)
      let q = p - L.at.xyz;
      d = frayed(d, vec3f(dot(q, L.x.xyz), dot(q, L.y.xyz), dot(q, L.z.xyz)) + L.half.w * 1.7);
    }
    if (d > out.x) {
      out.x = d;
      which = i;
    }
  }
  return out;
}
fn sharp(p: vec3f) -> f32 { return sampleAt(p, true).x; }
// with its edges eaten into by finer stuff than the voxels hold (it goes with the wind)
fn fine(p: vec3f) -> f32 { return sharp(p); } // (sampleAt frays each cloud in its own way)
fn frayed(d: f32, w: vec3f) -> f32 {
  if (d < 0.002) { return 0.0; }
  // (both scales of it from one look: the coarse in x, the fine in y)
  let g = textureSampleLevel(grain, rep, w * P.fray.y + vec3f(P.fray.z * 0.5, -P.fray.z, P.fray.z * 0.5), 0.0);
  let n = g.x;
  let m = g.y;
  let eat = P.fray.x * (0.65 * n + 0.35 * m) * exp(-d * 9.0);
  return max(d - eat * 0.16, 0.0) * 1.15;
}
fn span(o: vec3f, d: vec3f) -> vec2f {
  let inv = 1.0 / select(d, vec3f(1e-6), abs(d) < vec3f(1e-6));
  let a = (-P.box.xyz - o) * inv;
  let b = (P.box.xyz - o) * inv;
  let lo = min(a, b);
  let hi = max(a, b);
  return vec2f(max(max(lo.x, max(lo.y, lo.z)), 0.0), min(hi.x, min(hi.y, hi.z)));
}
fn sky(d: vec3f) -> vec3f {
  let up = d.y + 0.12 * (1.0 - P.seaMore.w); // (over the water the haze sits on its horizon)
  var c = P.skyTone.rgb * (0.16 + 0.5 * exp(-abs(up) * 5.0));
  // strikes far off over the horizon: a glow low in the sky that way, flickering
  if (P.farTone.w > 0.0) {
    let across = atan2(d.x, -d.z);
    for (var k = 0u; k < 4u; k++) {
      let f = P.far[k];
      if (f.w <= 0.0) { continue; }
      var a = across - f.x;
      a = a - 6.2831853 * round(a / 6.2831853);
      let low = exp(-max(up, 0.0) / f.y) * smoothstep(-0.02, 0.0, up);
      c += P.farTone.rgb * f.w * exp(-a * a / 0.02) * low * (0.5 + 0.5 * exp(-a * a / 0.002));
    }
  }
  // a strike lights the air round it, the sky most where it is, and all of it a little
  if (P.reach.y > 0.0 && P.houseMore.z > 0.0) {
    for (var k = 0u; k < 6u; k++) {
      let f = P.flare[k * 3u + 2u];
      if (f.w <= 0.0) { continue; }
      let mid = (P.flare[k * 3u].xyz + P.flare[k * 3u + 1u].xyz) * 0.5 + P.drift.xyz;
      let toward = max(dot(d, normalize(mid - P.eye.xyz)), 0.0);
      c += f.rgb * f.w * P.houseMore.z * (0.0006 + 0.12 * pow(toward, 400.0) + 0.025 * pow(toward, 60.0)) * (0.5 + exp(-abs(up) * 3.0));
    }
  }
  return c;
}

// ---- the water ----

// its slope (dh/dx, dh/dz) where it is; waves smaller than a pixel there are left out, or the far water would glitter
fn waves(p: vec2f, foot: f32) -> vec2f {
  var g = vec2f(0.0);
  for (var i = 0; i < 10; i++) {
    let f = f32(i);
    let a = 0.55 * sin(f * 2.39 + 0.4); // (mostly coming at you: the glitter runs down the picture)
    let dir = vec2f(sin(a), cos(a));
    let len = 1.6 * pow(0.72, f);
    let k = 6.2831853 / len;
    let w = max(1.0, round(sqrt(k) * 1.3 * 40.0 / 6.2831853)) * 6.2831853 / 40.0; // (a whole number of times round in the loop of 40 s)
    let fade = smoothstep(3.0, 10.0, len / max(foot, 1e-4)); // (well before a pixel: else each one sees a different glint)
    g += dir * cos(dot(dir, p) * k - w * P.sea.z + f * 1.7) * 0.075 * P.sea.y * fade;
  }
  return g;
}
fn fresnel(d: vec3f, n: vec3f) -> f32 { return 0.02 + 0.98 * pow(1.0 - max(dot(-d, n), 0.0), 5.0); }
// where the eye's ray meets the water, how large a pixel is there, and how the water turns it
struct Wet { at: vec3f, n: vec3f, r: vec3f, f: f32 };
fn wet(o: vec3f, d: vec3f, perPixel: f32) -> Wet {
  var out: Wet;
  let t = (P.sea.x - o.y) / d.y;
  out.at = o + d * t;
  let g = waves(out.at.xz, t * perPixel / max(-d.y, 0.04));
  out.n = normalize(vec3f(-g.x, 1.0, -g.y));
  out.r = reflect(d, out.n);
  out.r.y = abs(out.r.y);
  out.f = fresnel(d, out.n);
  return out;
}

// ---- the clouds, seen ----

// (cheap, for what the water gives back: longer steps, no fine shade)
// ---- the lighthouse ----
const LAMP = vec3f(1.0, 0.8, 0.52);
// (the depth the house and the bolts are drawn with; with three.js: as it draws the house, with its near 0.1 and far 100)
fn depthOf(z: f32) -> f32 {
  if (P.opt.w > 0.5) { return clamp(100.0 / 99.9 * (1.0 - 0.1 / max(z, 0.1)), 0.0, 1.0); }
  return clamp(z / 200.0, 0.0, 1.0);
}
// (two beams, back to back, turning; how much of them goes this way from the lamp)
fn beamAt(u: vec3f) -> f32 {
  let b = normalize(vec3f(cos(P.lamp.w), 0.03, sin(P.lamp.w)));
  let b2 = vec3f(-b.x, b.y, -b.z);
  return exp((max(dot(u, b), dot(u, b2)) - 1.0) / P.house.z);
}
fn beamOnCloud(p: vec3f) -> vec3f {
  if (P.houseMore.x == 0.0) { return vec3f(0.0); }
  let v = p - P.lamp.xyz;
  let r2 = dot(v, v);
  return LAMP * P.houseMore.y * beamAt(v * inverseSqrt(r2)) / (1.0 + r2);
}
// rain: falling streaks under cloud, in sheets, slanted by the wind (w: in the light's block). It starts where the
// cloud above it ends, so it has no top of its own; and thins out to the sides
@group(0) @binding(45) var rainMap: texture_2d<f32>;
fn rainAt(w: vec3f) -> f32 {
  if (w.y > P.rain.y) { return 0.0; }
  let src = vec3f(w.x - (P.rain.y - w.y) * P.rain.w, w.y, w.z); // (back up the way it fell)
  let edge = min(P.box.x - abs(src.x), P.box.z - abs(src.z));
  if (edge <= 0.0) { return 0.0; }
  var under = 0.0;
  if (P.opt.y > 0.5) {
    // (from the map of where there is cloud above, worked out once a frame or so)
    let at = src.xz / (2.0 * P.box.xz) + 0.5;
    under = textureSampleLevel(rainMap, lin, vec2f(at.x, at.y), 0.0).r;
  } else {
    var above = 0.0;
    for (var k = 1; k <= 4; k++) {
      let up = 0.08 + 0.4 * f32(k * k) * 0.25;
      above = max(above, density(vec3f(src.x - up * P.rain.w, w.y + up, src.z)));
    }
    under = smoothstep(0.003, 0.06, above);
  }
  let cover = under * smoothstep(0.0, 0.9, edge) * smoothstep(0.0, 0.5, P.rain.y - w.y);
  if (cover <= 0.0) { return 0.0; }
  let fall = P.rain.z * P.sea.z / 40.0; // (a whole number of times through in a loop)
  let streak = textureSampleLevel(grain, rep, vec3f(src.x * 1.6, w.y * 0.09 + fall, src.z * 1.6), 0.0).y; // (a few pixels wide, long)
  let sheet = textureSampleLevel(grain, rep, vec3f(src.x * 0.55 + 0.3, fall * 0.25, src.z * 0.55), 0.0).x;
  let sea = smoothstep(0.0, 0.03, w.y - P.sea.x);
  return cover * sea * (0.08 + 0.92 * smoothstep(0.5, 0.85, streak)) * smoothstep(0.42, 0.72, sheet); // (in shafts, with air between them)
}
// the bolts' light on clouds out of the light's block: each as a line, falling off with distance
struct Flare { light: vec3f, to: vec3f };
fn flareAt(w: vec3f) -> Flare {
  var f = Flare(vec3f(0.0), vec3f(0.0));
  let r2 = P.reach.x * P.reach.x;
  for (var k = 0u; k < 6u; k++) {
    let c = P.flare[k * 3u + 2u];
    if (c.w <= 0.0) { continue; }
    let a = P.flare[k * 3u].xyz;
    let ab = P.flare[k * 3u + 1u].xyz - a;
    let dv = a + ab * clamp(dot(w - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0) - w;
    let d2 = dot(dv, dv);
    let e = c.w * r2 / (d2 + r2);
    f.light += c.rgb * e;
    f.to += dv * inverseSqrt(max(d2, 1e-6)) * e;
  }
  return f;
}
var<private> firstT: f32; // (how far the ray went before it first met cloud)
fn cloud(o: vec3f, d: vec3f, jump: f32, cheap: bool) -> vec4f {
  firstT = 1e9;
  let h = hits(o, d, 0.0);
  let ahead = h.mask; // (all it goes through: for looking off the ray, in the fine shade)
  let keep = pool;
  pool = ahead; // (and when which it is in is worked out again, only those are tried)
  var col = vec3f(0.0);
  var left = 1.0;
  if (any(h.mask != vec2u(0u))) {
    let step = P.thick.z * select(1.0, P.cut.y, cheap);
    var t = h.near + step * jump;
    // (at each step, only those it is in there are looked in; which those are is worked out again where that changes)
    var next = -1.0;
    for (var i = 0; i < 700 && t < h.far; i++) {
      if (t >= next) {
        let now = hits(o, d, t);
        cnt[3] += 1u;
        if (all(now.mask == vec2u(0u))) { break; }
        mask = select(now.mask, now.act, P.opt.x > 0.5);
        next = select(now.far, now.next, P.opt.x > 0.5);
        if (all(now.act == vec2u(0u))) {
          // (between them: on to the next it comes into)
          t = now.near + step * jump;
          continue;
        }
      }
      let p = o + d * t;
      cnt[select(1u, 4u, cheap)] += 1u;
      let m = sampleAt(p, !cheap);
      if (m.z == 0.0) {
        t += step;
        continue;
      }
      if (m.y < 0.004) {
        // (nothing here: on by as far as it is to the nearest cloud, or a little way at least, but not past where the
        // clouds it is in change)
        let leap = max(P.box.w * 6.0, gap * max(P.cut.w, 0.0));
        t += min(leap, max(next - t, step));
        continue;
      }
      // (the clouds further back, not hers nor its, are soft and far: a longer step through them)
      let dt = step * select(1.0, lumps[which].x.w, m.x > 0.0); // (each cloud's own: longer through the far ones, and the dragon's if asked)
      let v = select(m.x, m.x * 1.1, cheap);
      if (v > 0.001) {
        cnt[select(2u, 5u, cheap)] += 1u;
        if (lumps[which].half.w >= 100.0) { cnt[14] += 1u; }
        firstT = min(firstT, t);
        let ext = v * P.thick.x;
        let w = local(p);
        let q = place(w);
        let there = inBlock(w) * P.reach.w; // (and not at all as the block goes over to the other shape: see `handing`)
        let g = textureSampleLevel(glow, lin, q, 0.0) * there;
        var lit = 1.0;
        var l = textureSampleLevel(still, lin, q, 0.0);
        if (there < 0.999 && cheap) {
          l = mix(vec4f(0.3, 0.5, 0.0, 0.0), l, there);
        } else if (there < 0.999) {
          // (outside the light's block: the moon's shade and the sky's, from a few steps their way through the clouds)
          // (in its own coarse copy only: far off, the shade of others on it is not missed)
          let L = lumps[which];
          var toMoon = 0.0;
          var toSky = 0.0;
          var at = 0.0;
          for (var k = 0; k < 3; k++) {
            let ds = 0.06 * pow(2.4, f32(k));
            at += ds;
            let am = inAtlas(L, p + P.moon.xyz * at);
            if (inside(L, am)) { let v = textureSampleLevel(atlasMean, lin, am, 0.0).r; toMoon += v * v * L.lo.w * ds; }
            if (k < 2) {
              let au = inAtlas(L, p + vec3f(0.0, at, 0.0));
              if (inside(L, au)) { let v = textureSampleLevel(atlasMean, lin, au, 0.0).r; toSky += v * v * L.lo.w * ds; }
            }
          }
          let tm = toMoon * P.thick.x;
          let ts = toSky * P.thick.x;
          let far = vec4f(0.55 * exp(-tm) + 0.3 * exp(-tm * 0.35) + 0.15 * exp(-tm * 0.1), 0.25 + 0.75 * exp(-ts * 0.3), 0.0, 0.0);
          l = mix(far, l, there);
        }
        if (P.fray.w > 0.0 && g.a > 0.01 && !cheap) {
          cnt[12] += 1u;
          cphase = 2u;
          // the fine shade: the way the light comes from, and what stands that way close by
          var to = vec3f(0.0, 1.0, 0.0);
          if (P.haze.w > 0.0) {
            // (toward where the bolts are, as lines: the same way all over a cloud, so its detail stays put)
            let f = flareAt(w).to;
            to = f / max(length(f), 1e-5);
          } else {
            let e = 1.0 / vec3f(textureDimensions(glow));
            let up = vec3f(
              textureSampleLevel(glow, lin, q + vec3f(e.x, 0.0, 0.0), 0.0).a,
              textureSampleLevel(glow, lin, q + vec3f(0.0, e.y, 0.0), 0.0).a,
              textureSampleLevel(glow, lin, q + vec3f(0.0, 0.0, e.z), 0.0).a) - g.a;
            to = up / max(length(up), 1e-5);
          }
          let s = P.thick.w;
          // (close by, in the cloud it is in only; further, in all of them, coarsely)
          let L = lumps[which];
          // (one look that way, in all the clouds there: in only the densest, it flips as they slide over each other)
          let these = mask;
          mask = ahead;
          let close = fine(p + to * s * 0.7) * 1.25;
          mask = these;
          let dark = (close + density(w + to * s * 2.2) * 1.2) * s * P.thick.x;
          lit = mix(1.0, 0.13 + 1.9 * exp(-dark * 0.5), P.fray.w);
          cphase = select(0u, 1u, cheap);
        }
        var source = g.rgb * lit + P.moonTone.rgb * l.x + P.skyTone.rgb * l.y + beamOnCloud(p);
        if (P.reach.y > 0.0 && there < 0.999) {
          // (out of the light's block: lit by the bolts all the same, through a few steps of its own cloud their way)
          let F = flareAt(w);
          var through = 0.6;
          if (!cheap && dot(F.to, F.to) > 1e-8) {
            let to = normalize(F.to);
            let L = lumps[which];
            var deep = 0.0;
            var at = 0.0;
            for (var k = 0; k < 3; k++) {
              let ds = 0.06 * pow(2.4, f32(k));
              at += ds;
              let a = inAtlas(L, p + to * at);
              if (inside(L, a)) { let v = textureSampleLevel(atlasMean, lin, a, 0.0).r; deep += v * v * L.lo.w * ds; }
            }
            let tb = deep * P.thick.x;
            through = 0.6 * exp(-tb) + 0.4 * exp(-tb * 0.2);
          }
          source += F.light * through * (1.0 - there);
        }
        let through = exp(-ext * dt);
        col += left * (1.0 - through) * source;
        left *= through;
        if (left < P.cut.x) { left = 0.0; break; }
      }
      t += dt;
    }
  }
  pool = keep;
  return vec4f(col, left);
}
@fragment
fn march(@builtin(position) at: vec4f) -> @location(0) vec4f {
  if (P.houseMore.w == 1.0) { return vec4f(0.0, 0.0, 0.0, 1.0); } // (to time the pass without its work)
  let uv = (at.xy / P.size.xy * 2.0 - 1.0) * vec2f(1.0, -1.0);
  let o = P.eye.xyz;
  let d = normalize(P.fore.xyz + P.right.xyz * uv.x + P.up.xyz * uv.y);
  let jump = fract(52.9829189 * fract(dot(floor(at.xy), vec2f(0.06711056, 0.00583715))));
  let tx = (u32(P.size.x) + 15u) / 16u;
  pool = tiles[(u32(at.y) / 16u) * tx + u32(at.x) / 16u];
  var c = cloud(o, d, jump, false);
  pool = everyLump();
  if (P.seaMore.w > 0.0 && d.y < 0.0 && c.a > 0.004) {
    // the water: what is above it, by its waves, and its own dark (the bolts in it are added at full size, in over)
    let w = wet(o, d, P.size.z);
    var back = vec4f(0.0, 0.0, 0.0, 1.0);
    cphase = 1u;
    if (P.sea.w > 0.0) { back = cloud(w.at, w.r, jump, true); }
    cphase = 0u;
    c = vec4f(c.rgb + c.a * (w.f * P.sea.w * (back.rgb + back.a * sky(w.r)) + P.seaMore.rgb), c.a);
  }
  let hitT = firstT;
  var seaT = 1e9;
  if (P.seaMore.w > 0.0 && d.y < 0.0) { seaT = (P.sea.x - o.y) / d.y; }
  // the air between: what is far off goes toward the colour of the sky (before the rain, which is near: the water
  // behind it may be far, and the rain in front of it would go with it, dark under the horizon and lit above)
  if (P.haze.x > 0.0) {
    let far = min(hitT, seaT);
    if (far < 1e8) {
      let seen = exp(-max(far - P.haze.y, 0.0) * P.haze.x);
      let covers = select(1.0 - c.a, 1.0, seaT < hitT);
      c = vec4f(seen * c.rgb + (1.0 - seen) * covers * sky(d), select(c.a, c.a * seen, seaT < hitT));
    }
  }
  // rain, under the clouds whose time it is, in front of what is behind it
  if (P.rain.x > 0.0) {
    let lo = vec3f(P.drift.x - P.box.x, P.sea.x, -P.box.z);
    let hi = vec3f(P.drift.x + P.box.x, P.rain.y, P.box.z);
    let inv = 1.0 / select(d, vec3f(1e-6), abs(d) < vec3f(1e-6));
    let a = (lo - o) * inv;
    let b = (hi - o) * inv;
    let t0 = max(max(min(a.x, b.x), max(min(a.y, b.y), min(a.z, b.z))), 0.0);
    let t1 = min(min(max(a.x, b.x), min(max(a.y, b.y), max(a.z, b.z))), min(hitT, seaT));
    if (t1 > t0) {
      let N = 24;
      let dt = (t1 - t0) / f32(N);
      var flash = vec3f(0.0);
      for (var k = 0u; k < 6u; k++) { let f = P.flare[k * 3u + 2u]; flash += f.rgb * max(f.w, 0.0); }
      var light = vec3f(0.0);
      var through = 1.0;
      for (var i = 0; i < N; i++) {
        let p = o + d * (t0 + (f32(i) + jump) * dt);
        let r = rainAt(local(p));
        if (r <= 0.0) { continue; }
        // (dark but for a strike: lit by each bolt close by, and a little by all of them, as the air is)
        let lit = flareAt(local(p)).light * 0.6 + flash * 0.015 + P.moonTone.rgb * 0.06 + P.skyTone.rgb * 0.12 + beamOnCloud(p) * 0.6;
        let k = 1.0 - exp(-r * P.rain.x * dt * 5.0);
        light += through * k * lit;
        through *= 1.0 - k;
      }
      c = vec4f(light + through * c.rgb, c.a * through);
    }
  }
  // (the lighthouse's beam in the air: here, at the size the clouds are marched at, as it is soft)
  if (P.houseMore.x > 0.0) {
    var far = 40.0;
    if (d.y < 0.0) { far = min(far, (P.sea.x - o.y) / d.y); }
    c = vec4f(c.rgb + beamFor(o, d, far, jump), c.a);
  }
  // (the sky behind, here and not when it is brought up to the screen's size: a pixel at the horizon made from marched
  // ones on both sides of it would else be left without the water's colour, or the sky's: a dark line)
  if (d.y >= 0.0 || P.seaMore.w == 0.0) { c = vec4f(c.rgb + c.a * sky(d), c.a); }
  if (P.cut.z > 0.5) {
    cnt[0] = 1u;
    for (var k = 0u; k < 16u; k++) { if (cnt[k] > 0u) { atomicAdd(&counts[k], cnt[k]); } }
  }
  return c;
}

// ---- the bolts ----

struct Piece { a: vec4f, b: vec4f };
@group(0) @binding(9) var<storage, read> pieces: array<Piece>;
struct Wire { glow: vec4f, tone: vec4f }; // how far up it has come, how bright; its colour
@group(0) @binding(10) var<uniform> W: array<Wire, 6>;
struct Ribbon {
  @builtin(position) at: vec4f,
  @location(0) side: vec2f, // across, and the core's share of the width
  @location(1) bright: vec2f, // core, halo
  @location(2) @interpolate(flat) tone: vec3f,
};
@vertex
fn ribbon(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Ribbon { return ribbonOf(v, i, false); }
// as seen in still water: drawn as though it hung upside down under it, and looked at through the water by over
@vertex
fn ribbonSea(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Ribbon { return ribbonOf(v, i, true); }
// how much of a bolt gets through the cloud before it, from a place on it (in the water: on its way down to the water
// and up to the eye, as straight as from the eye's own image under the water)
fn coverOf(p: vec3f, sea: bool) -> f32 {
  let eye = select(P.eye.xyz, vec3f(P.eye.x, 2.0 * P.sea.x - P.eye.y, P.eye.z), sea);
  let d = normalize(eye - p);
  var deep = 0.0;
  let n = 64;
  pool = everyLump();
  let h = hits(p, d, 0.0);
  mask = h.mask;
  let far = min(h.far, length(eye - p));
  if (all(h.mask == vec2u(0u)) || far <= 0.0) { return 1.0; }
  for (var s = 0; s < n; s++) {
    let x = (f32(s) + 0.5) / f32(n);
    deep += fine(p + d * far * x * x) * 2.0 * x;
  }
  return exp(-deep * far / f32(n) * P.thick.x);
}
// (worked out once for each end of each piece of the bolts that are lit, not at each of its six corners, twice over)
struct Ranges { r: array<vec4u, 6> }; // each bolt's first piece, how many, 1 if it is lit
@group(0) @binding(46) var<uniform> RG: Ranges;
@group(0) @binding(47) var<storage, read_write> coverOut: array<vec4f>; // from a, from b; and in the water
@group(0) @binding(48) var<storage, read> covered: array<vec4f>;
@compute @workgroup_size(64)
fn cover(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= arrayLength(&coverOut)) { return; }
  var k = 6u;
  for (var j = 0u; j < 6u; j++) {
    let r = RG.r[j];
    if (r.z > 0u && i >= r.x && i < r.x + r.y) { k = j; }
  }
  if (k == 6u) { return; }
  let shift = vec3f(W[k].glow.z, 0.0, 0.0);
  let a = pieces[i].a.xyz + shift;
  let b = pieces[i].b.xyz + shift;
  var out = vec4f(coverOf(a, false), coverOf(b, false), 1.0, 1.0);
  if (P.seaMore.w > 0.0) {
    out.z = coverOf(a, true);
    out.w = coverOf(b, true);
  }
  coverOut[i] = out;
}
fn ribbonOf(v: u32, i: u32, sea: bool) -> Ribbon {
  var out: Ribbon;
  let c = v % 10u;
  let k = v / 10u; // (which of them: told by the first vertex drawn)
  let w = W[k];
  var A = pieces[i].a;
  var Z = pieces[i].b;
  // (where the wind had taken the clouds when it struck: it stays there)
  A = vec4f(A.xyz + vec3f(w.glow.z, 0.0, 0.0), A.w);
  Z = vec4f(Z.xyz + vec3f(w.glow.z, 0.0, 0.0), Z.w);
  let real = mat2x3f(A.xyz, Z.xyz);
  if (sea) {
    A.y = 2.0 * P.sea.x - A.y;
    Z.y = 2.0 * P.sea.x - Z.y;
  }
  let lum = abs(A.w);
  let main = A.w > 0.0;
  var fire = w.glow.y * smoothstep(w.glow.x - 0.04, w.glow.x + 0.02, Z.w) * select(P.wire.y * lum, 1.0, main);
  out.at = vec4f(2.0, 2.0, 2.0, 1.0);
  if (fire < 0.0015) { return out; }
  let end = (c == 1u || c == 2u || c == 4u);
  let side = select(-1.0, 1.0, c == 2u || c == 4u || c == 5u);
  let source = A.xyz - P.eye.xyz;
  let to = Z.xyz - P.eye.xyz;
  let view = vec3f(dot(P.right.xyz, P.right.xyz), dot(P.up.xyz, P.up.xyz), 0.0);
  let pa = vec3f(dot(source, P.right.xyz) / view.x, dot(source, P.up.xyz) / view.y, dot(source, P.fore.xyz));
  let pb = vec3f(dot(to, P.right.xyz) / view.x, dot(to, P.up.xyz) / view.y, dot(to, P.fore.xyz));
  if (pa.z < 0.05 || pb.z < 0.05) { return out; }
  let half = P.more.xy * 0.5;
  let a = pa.xy / pa.z * half;
  let b = pb.xy / pb.z * half;
  let along = normalize(b - a + vec2f(1e-4, 0.0));
  let r = P.wire.x * select(0.25 + 0.6 * sqrt(lum), 1.0, main);
  let z = mix(pa.z, pb.z, f32(end));
  let px = P.more.z;
  let wane = pow(min(fire, 1.0), 0.7); // (its middle goes out before its light does)
  let core = sqrt(r * r / (z * z * px * px) + 0.3); // in pixels
  let wide = core * 2.2 + P.wire.z * r / (z * px) * 3.0 + 1.0;
  let pt = mix(a, b, f32(end)) + (vec2f(-along.y, along.x) * side + along * select(-0.25, 0.25, end)) * wide;
  // how much of it gets through the cloud before it
  let p = mix(real[0], real[1], f32(end));
  let eye = select(P.eye.xyz, vec3f(P.eye.x, 2.0 * P.sea.x - P.eye.y, P.eye.z), sea);
  fire *= smoothstep(0.05, 0.4, length(eye - p)); // (not in one's face)
  var through = 1.0;
  if (P.opt.z > 0.5) {
    let cv = covered[i];
    through = select(select(cv.x, cv.y, end), select(cv.z, cv.w, end), sea);
  } else {
    through = coverOf(p, sea);
  }
  out.at = vec4f(pt / half, depthOf(z), 1.0);
  out.side = vec2f(side * wide, core);
  out.bright = vec2f(fire * wane * through * min(1.0, r / (z * px) / core), fire * through * sqrt(lum));
  out.tone = w.tone.rgb;
  return out;
}
@fragment
fn spark(in: Ribbon) -> @location(0) vec4f {
  let x = in.side.x / in.side.y;
  let skin = exp(-abs(in.side.x) / (in.side.y * P.wire.z)) * 0.06;
  return vec4f(mix(in.tone, vec3f(1.0), P.hot.x) * P.wire.w * in.bright.x * exp(-x * x) + in.tone * P.more.w * in.bright.y * skin, 1.0);
}

// ---- the atlas's coarse copies, once; the coarse block, every frame ----

@group(0) @binding(13) var atlasIn: texture_3d<f32>;
@group(0) @binding(14) var coarseOut: texture_storage_3d<rgba8unorm, write>;
struct Shrink { by: vec4u }; // how many to a texel; how far round it to look, in texels
@group(0) @binding(15) var<uniform> SH: Shrink;
@compute @workgroup_size(4, 4, 4)
fn mostOf(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(textureDimensions(atlasIn));
  let k = i32(SH.by.x);
  let r = i32(SH.by.y) * k;
  let c = vec3i(id) * k;
  if (any(c >= n)) { return; }
  var most = 0.0;
  for (var z = -r; z < k + r; z += 2) { for (var y = -r; y < k + r; y += 2) { for (var x = -r; x < k + r; x += 2) {
    most = max(most, textureLoad(atlasIn, clamp(c + vec3i(x, y, z), vec3i(0), n - 1), 0).r);
  } } }
  textureStore(coarseOut, id, vec4f(min(1.0, most * 1.3), 0.0, 0.0, 1.0));
}
@compute @workgroup_size(4, 4, 4)
fn meanOf(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(textureDimensions(atlasIn));
  let k = i32(SH.by.x);
  let c = vec3i(id) * k;
  if (any(c >= n)) { return; }
  var sum = 0.0;
  for (var z = 0; z < k; z++) { for (var y = 0; y < k; y++) { for (var x = 0; x < k; x++) {
    let v = textureLoad(atlasIn, min(c + vec3i(x, y, z), n - 1), 0).r;
    sum += v * v;
  } } }
  textureStore(coarseOut, id, vec4f(sqrt(sum / f32(k * k * k)), 0.0, 0.0, 1.0));
}
@compute @workgroup_size(4, 4, 4)
fn makeCoarse(@builtin(global_invocation_id) gid: vec3u) {
  let n = textureDimensions(coarseOut);
  let id = gid + vec3u(0u, 0u, SH.by.z); // (half of it a frame, from SH.by.z up)
  if (any(id >= n)) { return; }
  let p = ((vec3f(id) + 0.5) / vec3f(n) * 2.0 - 1.0) * P.box.xyz + P.drift.xyz;
  var most = 0.0;
  let count = u32(P.drift.w);
  for (var i = 0u; i < count; i++) {
    let L = lumps[i];
    let a = inAtlas(L, p);
    if (!inside(L, a)) { continue; }
    let v = textureSampleLevel(atlasMean, lin, a, 0.0).r;
    most = max(most, v * v * L.lo.w);
  }
  textureStore(coarseOut, id, vec4f(sqrt(clamp(most, 0.0, 1.0)), 0.0, 0.0, 1.0));
}

// ---- finer stuff: billows and, finer, again (repeats) ----

@group(0) @binding(17) var grainOut: texture_storage_3d<rgba8unorm, write>;
fn scramble(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn unit01(v: u32) -> f32 { return f32(v >> 8u) / 16777216.0; }
fn worley(p: vec3f, cells: i32) -> f32 {
  let i = vec3i(floor(p));
  var best = 9.0;
  for (var z = -1; z < 2; z++) { for (var y = -1; y < 2; y++) { for (var x = -1; x < 2; x++) {
    let c = i + vec3i(x, y, z);
    let w = ((c % cells) + cells) % cells;
    let h = scramble(u32(w.x) + 137u * u32(w.y) + 7919u * u32(w.z) + u32(cells) * 31337u);
    let h2 = scramble(h);
    let q = vec3f(c) + vec3f(unit01(h), unit01(h2), unit01(scramble(h2))) - p;
    best = min(best, dot(q, q));
  } } }
  return clamp(sqrt(best), 0.0, 1.0);
}
@compute @workgroup_size(4, 4, 4)
fn makeGrain(@builtin(global_invocation_id) id: vec3u) {
  let u = (vec3f(id) + 0.5) / 96.0;
  let a = 0.6 * worley(u * 6.0, 6) + 0.4 * worley(u * 12.0, 12);
  let b = 0.6 * worley(u * 18.0, 18) + 0.4 * worley(u * 30.0, 30);
  textureStore(grainOut, id, vec4f(a, b, 0.0, 1.0));
}

// ---- the light in the clouds, worked out once ----

struct Bake { first: u32, many: u32, turn: u32, pad: u32, worth: f32, mean: f32, pad1: f32, pad2: f32, size: vec4u };
@group(0) @binding(18) var<uniform> K: Bake;
@group(0) @binding(19) var<storage, read_write> tallied: array<atomic<u32>>;
@group(0) @binding(20) var<storage, read> done: array<u32>;
@group(0) @binding(21) var made: texture_storage_3d<rgba16float, write>;
@group(0) @binding(34) var before: texture_3d<f32>;

var<private> seed: u32;
fn rnd() -> f32 {
  seed = scramble(seed);
  return unit01(seed);
}
fn anyway() -> vec3f {
  let z = rnd() * 2.0 - 1.0;
  let a = rnd() * 6.2831853;
  let r = sqrt(max(1.0 - z * z, 0.0));
  return vec3f(r * cos(a), z, r * sin(a));
}
@compute @workgroup_size(64)
fn photons(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x + K.turn * 8192u; // (a few thousand a frame, every frame: none heavier than another)
  // (the same photons each time it is worked out again: only what changes in the clouds changes the light, and no
  // new noise is put in each time; one bolt's not the same as another's)
  seed = scramble(index ^ 0x5bd1e995u ^ (K.first * 0x9e3779b9u));
  let k = min(u32(unit01(scramble(index * 3679390609u)) * f32(K.many)), K.many - 1u) + K.first;
  let A = pieces[k].a;
  let Z = pieces[k].b;
  var p = mix(A.xyz, Z.xyz, rnd()) + vec3f(bitcast<f32>(K.size.w), 0.0, 0.0); // (where it is: it stays where it struck)
  let channel = min(u32(Z.w * 4.0), 3u);
  let worth = length(Z.xyz - A.xyz) / K.mean * 64.0;
  var d = anyway();
  var want = -log(max(rnd(), 1e-6));
  if (any(abs(p) > P.box.xyz)) { // (from outside: it starts where it comes in)
    let s = span(p, d);
    if (s.y <= s.x) { return; }
    p += d * s.x;
  }
  let size = vec3f(K.size.xyz);
  let step = K.pad1;
  for (var i = 0; i < 520; i++) {
    p += d * step;
    if (any(abs(p) >= P.box.xyz)) { return; }
    let c = min(vec3u(place(p) * size), K.size.xyz - 1u);
    atomicAdd(&tallied[((c.z * K.size.y + c.y) * K.size.x + c.x) * 4u + channel], u32(worth));
    let ext = density(p) * P.thick.x * P.thick.y;
    want -= ext * step;
    if (want < 0.0) {
      d = anyway();
      want = -log(max(rnd(), 1e-6));
    }
  }
}
// (and mixed into what was worked out before, so the light changes with the cloud and its grain does not flicker)
@compute @workgroup_size(4, 4, 4)
fn settle(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(K.size.xyz);
  let p = vec3i(id);
  if (any(p >= n)) { return; }
  var sum = vec4f(0.0);
  var area = 0.0;
  for (var r = 0; r <= 2; r++) {
    for (var z = -r; z <= r; z++) { for (var y = -r; y <= r; y++) { for (var x = -r; x <= r; x++) {
      if (max(abs(x), max(abs(y), abs(z))) != r) { continue; }
      let q = p + vec3i(x, y, z);
      if (any(q < vec3i(0)) || any(q >= n)) { continue; }
      let i = u32((q.z * n.y + q.y) * n.x + q.x) * 4u;
      let w = exp(-f32(x * x + y * y + z * z) * 0.5);
      sum += w * vec4f(f32(done[i]), f32(done[i + 1u]), f32(done[i + 2u]), f32(done[i + 3u]));
      area += w;
    } } }
    if (r > 0 && dot(sum, vec4f(1.0)) > 64.0 * 900.0) { break; }
  }
  textureStore(made, p, mix(textureLoad(before, p, 0), sum / area * K.worth, K.pad2));
}
@compute @workgroup_size(4, 4, 4)
fn moonlight(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(K.size.xyz);
  let c = vec3i(id) + vec3i(0, 0, i32(K.pad)); // (a few slices of it a frame, from K.pad up)
  if (any(c >= n)) { return; }
  let p = ((vec3f(c) + 0.5) / vec3f(n) * 2.0 - 1.0) * P.box.xyz;
  var out = vec4f(0.0, 0.0, 0.0, 1.0);
  for (var k = 0; k < 7; k++) {
    var d = P.moon.xyz;
    if (k > 0) {
      let a = f32(k) * 2.399963;
      let y = 1.0 - (f32(k) - 0.5) / 6.0 * 1.15;
      d = vec3f(cos(a) * sqrt(max(1.0 - y * y, 0.0)), y, sin(a) * sqrt(max(1.0 - y * y, 0.0)));
    }
    let far = span(p, d).y;
    var deep = 0.0;
    for (var i = 0; i < 40; i++) {
      let x = (f32(i) + 0.5) / 40.0;
      deep += density(p + d * far * x * x) * 2.0 * x;
    }
    deep *= far / 40.0 * P.thick.x;
    // what is turned aside is not lost: some of it comes all the same
    let t = 0.55 * exp(-deep) + 0.3 * exp(-deep * 0.35) + 0.15 * exp(-deep * 0.1);
    if (k == 0) { out.x = t; } else { out.y += t / 6.0; }
  }
  textureStore(made, c, out);
}

// ---- the light of all the bolts, a frame's ----

struct Gather { shine: array<vec4f, 6>, tone: array<vec4f, 6>, near: vec4f, shift: array<vec4f, 6> }; // how bright each quarter of each is; its colour; how white the light is close by; how far behind the clouds it is (of the block)
@group(0) @binding(25) var<uniform> G: Gather;
@group(0) @binding(26) var glow0: texture_3d<f32>;
@group(0) @binding(27) var glow1: texture_3d<f32>;
@group(0) @binding(28) var glow2: texture_3d<f32>;
@group(0) @binding(29) var glow3: texture_3d<f32>;
@group(0) @binding(30) var glow4: texture_3d<f32>;
@group(0) @binding(31) var glow5: texture_3d<f32>;
fn glowAt(k: u32, c: vec3u) -> vec4f {
  switch k {
    case 0u: { return textureLoad(glow0, c, 0); }
    case 1u: { return textureLoad(glow1, c, 0); }
    case 2u: { return textureLoad(glow2, c, 0); }
    case 3u: { return textureLoad(glow3, c, 0); }
    case 4u: { return textureLoad(glow4, c, 0); }
    default: { return textureLoad(glow5, c, 0); }
  }
}
@compute @workgroup_size(4, 4, 4)
fn gather(@builtin(global_invocation_id) id: vec3u) {
  var out = vec4f(0.0);
  for (var k = 0u; k < 6u; k++) {
    if (G.tone[k].w == 0.0) { continue; }
    // (its light was worked out where it is in the clouds; it struck a while ago, so it is that far behind them now)
    // (to the nearest voxel: the light is soft enough not to show it)
    let n = vec3i(textureDimensions(made));
    let c = vec3i(id) - vec3i(round(G.shift[k].xyz * vec3f(n)));
    if (any(c < vec3i(0)) || any(c >= n)) { continue; }
    let lit = dot(glowAt(k, vec3u(c)), G.shine[k]);
    out += lit * vec4f(mix(G.tone[k].rgb, vec3f(1.0), G.near.x * lit / (lit + G.near.y)), 1.0);
  }
  textureStore(made, id, out);
}

// ---- the clouds over the sky, at full size ----

@group(0) @binding(22) var marched: texture_2d<f32>;
@group(0) @binding(38) var mirrored: texture_2d<f32>; // the bolts, upside down under the water
// (the clouds marched at a smaller size, brought up sharply: Catmull-Rom, in nine taps of the linear filter)
fn sharpUp(uv: vec2f) -> vec4f {
  let size = vec2f(textureDimensions(marched));
  let sp = uv * size;
  let tc = floor(sp - 0.5) + 0.5;
  let f = sp - tc;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let t0 = (tc - 1.0) / size;
  let t3 = (tc + 2.0) / size;
  let t12 = (tc + w2 / w12) / size;
  var c = textureSampleLevel(marched, lin, vec2f(t0.x, t0.y), 0.0) * w0.x * w0.y;
  c += textureSampleLevel(marched, lin, vec2f(t12.x, t0.y), 0.0) * w12.x * w0.y;
  c += textureSampleLevel(marched, lin, vec2f(t3.x, t0.y), 0.0) * w3.x * w0.y;
  c += textureSampleLevel(marched, lin, vec2f(t0.x, t12.y), 0.0) * w0.x * w12.y;
  c += textureSampleLevel(marched, lin, vec2f(t12.x, t12.y), 0.0) * w12.x * w12.y;
  c += textureSampleLevel(marched, lin, vec2f(t3.x, t12.y), 0.0) * w3.x * w12.y;
  c += textureSampleLevel(marched, lin, vec2f(t0.x, t3.y), 0.0) * w0.x * w3.y;
  c += textureSampleLevel(marched, lin, vec2f(t12.x, t3.y), 0.0) * w12.x * w3.y;
  c += textureSampleLevel(marched, lin, vec2f(t3.x, t3.y), 0.0) * w3.x * w3.y;
  return vec4f(max(c.rgb, vec3f(0.0)), clamp(c.a, 0.0, 1.0));
}
@fragment
fn over(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = at.xy / P.more.xy;
  let h = 0.5 / vec2f(textureDimensions(marched));
  var c = vec4f(0.0);
  if (P.haze.z > 0.0) {
    c = sharpUp(uv);
  } else {
    for (var i = 0; i < 4; i++) { c += 0.25 * textureSampleLevel(marched, lin, uv + h * vec2f(f32(i & 1) * 2.0 - 1.0, f32(i >> 1) * 2.0 - 1.0), 0.0); }
  }
  let q = (uv * 2.0 - 1.0) * vec2f(1.0, -1.0);
  let d = normalize(P.fore.xyz + P.right.xyz * q.x + P.up.xyz * q.y);
  if (P.seaMore.w > 0.0 && d.y < 0.0) {
    // the bolts in the water: where in the picture of them, upside down, this way off the water looks
    let w = wet(P.eye.xyz, d, P.more.z);
    let m = vec3f(w.r.x, -w.r.y, w.r.z); // (the same way, in the picture drawn from above)
    let z = dot(m, P.fore.xyz);
    if (z > 0.01) {
      let s = vec2f(dot(m, P.right.xyz) / dot(P.right.xyz, P.right.xyz), dot(m, P.up.xyz) / dot(P.up.xyz, P.up.xyz)) / z;
      let at2 = (s * vec2f(1.0, -1.0)) * 0.5 + 0.5;
      // (a little blurred, most of all down the picture, as the streaks go)
      let h2 = 1.0 / vec2f(textureDimensions(mirrored));
      var b = vec3f(0.0);
      for (var i = -2; i <= 2; i++) {
        let w2 = 1.0 - abs(f32(i)) * 0.3;
        b += w2 * (textureSampleLevel(mirrored, lin, at2 + h2 * vec2f(0.5 * f32(i & 1) - 0.25, 1.5 * f32(i)), 0.0).rgb);
      }
      b /= 3.8;
      return vec4f(c.rgb + c.a * w.f * P.sea.w * b, 1.0);
    }
    return vec4f(c.rgb, 1.0);
  }
  return vec4f(c.rgb, 1.0); // (the sky is in it already)
}

// ---- the lighthouse on its rock: lit by each bolt from where that is, by the moon a little, by its own lamp close by ----
struct HouseOut { @builtin(position) at: vec4f, @location(0) p: vec3f, @location(1) n: vec3f, @location(2) c: vec4f };
fn project(p: vec3f) -> vec4f {
  let v = p - P.eye.xyz;
  let z = dot(v, P.fore.xyz);
  let s = vec2f(dot(v, P.right.xyz) / dot(P.right.xyz, P.right.xyz), dot(v, P.up.xyz) / dot(P.up.xyz, P.up.xyz));
  return vec4f(s, depthOf(z) * z, z);
}
fn placed(pos: vec3f, nor: vec3f, col: vec4f) -> HouseOut {
  var o: HouseOut;
  o.p = P.place.xyz + pos * P.place.w;
  o.n = nor;
  o.c = col;
  o.at = project(o.p);
  return o;
}
@vertex
fn house(@location(0) pos: vec3f, @location(1) nor: vec3f, @location(2) col: vec4f) -> HouseOut { return placed(pos, nor, col); }
@vertex
fn houseSea(@location(0) pos: vec3f, @location(1) nor: vec3f, @location(2) col: vec4f) -> HouseOut {
  var o = placed(pos, nor, col);
  o.at = project(vec3f(o.p.x, 2.0 * P.sea.x - o.p.y, o.p.z)); // (its image under the water, from the eye)
  return o;
}
@fragment
fn houseLit(in: HouseOut) -> @location(0) vec4f {
  if (in.p.y < P.sea.x) { discard; }
  var n = normalize(in.n);
  let toEye = normalize(P.eye.xyz - in.p);
  if (dot(n, toEye) < -0.2) { n = -n; }
  var light = vec3f(0.0);
  // each bolt, as the line it is from further off: from its side only, and a little all round (the sky is lit)
  let w = in.p - P.drift.xyz;
  let r2 = P.reach.x * P.reach.x;
  for (var k = 0u; k < 6u; k++) {
    let c = P.flare[k * 3u + 2u];
    if (c.w <= 0.0) { continue; }
    let a = P.flare[k * 3u].xyz;
    let ab = P.flare[k * 3u + 1u].xyz - a;
    let dv = a + ab * clamp(dot(w - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0) - w;
    let d2 = dot(dv, dv);
    let e = c.w * P.house.w * r2 / (d2 + r2);
    // (from its side; and the sky it lights, from above, a little)
    light += c.rgb * e * (max(dot(n, dv * inverseSqrt(d2)), 0.0) + 0.07 * (0.6 + 0.4 * n.y));
  }
  // the moon and the sky: hardly anything
  light += P.moonTone.rgb * max(dot(n, P.moon.xyz), 0.0) * 0.25 + P.skyTone.rgb * (0.6 + 0.4 * n.y) * 0.12;
  // its own lamp, on the gallery and the roof
  let lv = P.lamp.xyz - in.p;
  let ld2 = dot(lv, lv) / (P.place.w * P.place.w); // (in metres)
  light += LAMP * P.house.x * 0.6 / (1.0 + ld2) * (max(dot(n, lv * inverseSqrt(dot(lv, lv))), 0.0) * 0.8 + 0.2);
  var col = in.c.rgb * light;
  // wet rock, and the paint, shine back each bolt; at the water, foam
  let wet = select(select(0.0, 0.12, in.c.a > 0.97), select(0.5, 1.0, in.c.a < 0.875), in.c.a > 0.8 && in.c.a < 0.95);
  if (wet > 0.0) {
    for (var k = 0u; k < 6u; k++) {
      let c = P.flare[k * 3u + 2u];
      if (c.w <= 0.0) { continue; }
      let a = P.flare[k * 3u].xyz;
      let ab = P.flare[k * 3u + 1u].xyz - a;
      let dv = a + ab * clamp(dot(w - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0) - w;
      let d2 = dot(dv, dv);
      let h = normalize(dv * inverseSqrt(d2) + toEye);
      col += c.rgb * c.w * P.house.w * r2 / (d2 + r2) * wet * pow(max(dot(n, h), 0.0), select(24.0, 60.0, in.c.a < 0.95)) * 1.5;
    }
  }
  if (in.c.a > 0.8 && in.c.a < 0.95) {
    let above = (in.p.y - P.sea.x) / P.place.w; // (metres)
    let turn = 6.2831853 * P.sea.z / 40.0;
    let q = in.p.xz / P.place.w * 1.3 + vec2f(cos(turn), sin(turn)) * 2.0;
    let froth = smoothstep(0.35, 0.75, 0.5 + 0.5 * sin(q.x * 2.1 + sin(q.y * 1.7 + turn * 3.0) * 2.0) * sin(q.y * 2.6 - turn * 2.0));
    let foam = smoothstep(0.9, 0.0, above) * (0.4 + 0.6 * froth);
    col = mix(col, vec3f(0.75) * light, foam);
  }
  if (in.c.a < 0.4) {
    col += in.c.rgb * 0.5; // (a lit window)
  } else if (in.c.a < 0.75) {
    // the lantern: and brighter as a beam comes round to the eye
    col += LAMP * P.house.x * (0.5 + 30.0 * beamAt(normalize(P.eye.xyz - P.lamp.xyz)));
  }
  return vec4f(col, 1.0);
}

// the beam in the air: light scattered toward the eye along a ray, sampled by angle about the lamp (equiangular)
fn hg(c: f32, g: f32) -> f32 { return (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * c, 1.5)); }
fn beamFor(o: vec3f, d: vec3f, far: f32, jitter: f32) -> vec3f {
  let L = P.lamp.xyz;
  let tc = dot(L - o, d);
  let D = max(length(o + d * tc - L), 1e-4);
  let a0 = atan2(-tc, D);
  let a1 = atan2(far - tc, D);
  var sum = 0.0;
  let N = 24;
  for (var i = 0; i < N; i++) {
    let a = mix(a0, a1, (f32(i) + jitter) / f32(N));
    let u = normalize(o + d * (tc + D * tan(a)) - L);
    sum += beamAt(u) * hg(dot(u, -d), 0.55);
  }
  return LAMP * P.house.y * sum * (a1 - a0) / (f32(N) * D);
}

// where there is cloud above the rain's top, for it to fall from: across the light's block, looking up the way it falls
@group(0) @binding(44) var rainOut: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(8, 8)
fn rainCover(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(rainOut);
  if (any(id.xy >= n)) { return; }
  let src = ((vec2f(id.xy) + 0.5) / vec2f(n) * 2.0 - 1.0) * P.box.xz;
  var above = 0.0;
  for (var k = 0; k < 10; k++) {
    let up = -0.45 + f32(k) * 0.13; // (from a little below its top to a little above, as close as the rain looked before)
    above = max(above, density(vec3f(src.x - up * P.rain.w, P.rain.y + up, src.y)));
  }
  textureStore(rainOut, id.xy, vec4f(smoothstep(0.003, 0.06, above), 0.0, 0.0, 1.0));
}

