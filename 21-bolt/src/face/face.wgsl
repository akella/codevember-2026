// A flight through clouds that repeat along the way, and in them one shaped like a face. As clouds.wgsl: one block of
// density put together at the start (stamp, flesh), the light of each bolt followed through it once (photons), a march
// through both a frame, and the bolts over it as ribbons. The block's sampler repeats along z, and all else wraps.

struct Params {
  size: vec4f, // of the picture marched, radians a pixel, time
  eye: vec4f, // and what the march is started off by
  right: vec4f,
  up: vec4f,
  fore: vec4f,
  box: vec4f, // half the clouds' box, and a voxel
  thick: vec4f, // extinction at density 1; how much of that turns light aside; a step; how deep the picked-out detail is
  shine: array<vec4f, 2>, // how bright each quarter of each showing bolt is
  flash: vec4f, // the light of the bolts in cloud; and how much fine shade
  moon: vec4f, // the way to it
  moonTone: vec4f,
  skyTone: vec4f,
  fray: vec4f, // how much finer stuff eats the edges, and its size; then how far the far fades
  hot: vec4f,
  skin: vec4f,
  wire: vec4f, // how wide a bolt is, how bright its branches, its skin's width
  more: vec4f, // the picture's size, full
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var lin: sampler;
@group(0) @binding(2) var dense: texture_3d<f32>;
@group(0) @binding(3) var rough: texture_3d<f32>; // the most in each 8 voxels and round them
@group(0) @binding(4) var still: texture_3d<f32>; // the moon's light, the sky's
@group(0) @binding(5) var glowA: texture_3d<f32>; // the light of the two bolts showing
@group(0) @binding(6) var glowB: texture_3d<f32>;
@group(0) @binding(7) var grain: texture_3d<f32>;
@group(0) @binding(8) var rep: sampler;

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}
fn place(p: vec3f) -> vec3f { return p / P.box.xyz * 0.5 + 0.5; }
fn density(p: vec3f, level: f32) -> f32 {
  let v = textureSampleLevel(dense, lin, place(p), level).r;
  return v * v;
}
// with its edges eaten into by finer stuff than the voxels hold
fn fine(p: vec3f) -> f32 {
  let d = density(p, 0.0);
  if (d < 0.002) { return 0.0; }
  let n = textureSampleLevel(grain, rep, p * P.fray.y, 0.0);
  let eat = P.fray.x * (0.65 * n.x + 0.35 * n.y) * exp(-d * 9.0);
  return max(d - eat * 0.16, 0.0) * 1.15;
}
fn span(o: vec3f, d: vec3f) -> vec2f { // (it goes on for ever along z)
  let inv = 1.0 / select(d, vec3f(1e-6), abs(d) < vec3f(1e-6));
  let a = (-P.box.xyz - o) * inv;
  let b = (P.box.xyz - o) * inv;
  let lo = min(a, b);
  let hi = max(a, b);
  return vec2f(max(max(lo.x, lo.y), 0.0), min(min(hi.x, hi.y), P.fray.z));
}
fn sky(d: vec3f) -> vec3f {
  let up = d.y;
  return P.skyTone.rgb * (0.16 + 0.5 * exp(-abs(up + 0.12) * 5.0));
}

// ---- the clouds, seen ----

@fragment
fn march(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = (at.xy / P.size.xy * 2.0 - 1.0) * vec2f(1.0, -1.0);
  let o = P.eye.xyz;
  let d = normalize(P.fore.xyz + P.right.xyz * uv.x + P.up.xyz * uv.y);
  let s = span(o, d);
  var col = vec3f(0.0);
  var left = 1.0;
  if (s.y > s.x) {
    let jump = fract(52.9829189 * fract(dot(floor(at.xy) + P.eye.w * vec2f(5.3, 9.1), vec2f(0.06711056, 0.00583715))));
    var t = s.x + P.thick.z * jump;
    for (var i = 0; i < 380 && t < s.y; i++) {
      let p = o + d * t;
      let most = textureSampleLevel(rough, lin, place(p), 0.0).r;
      if (most < 0.004) {
        t += P.box.w * (4.0 + t * 0.6);
        continue;
      }
      let step = P.thick.z * (0.7 + t * 0.22);
      let v = fine(p);
      if (v > 0.001) {
        let ext = v * P.thick.x;
        let q = place(p);
        let a = textureSampleLevel(glowA, lin, q, 0.0);
        let b = textureSampleLevel(glowB, lin, q, 0.0);
        var lit = dot(a, P.shine[0]) + dot(b, P.shine[1]);
        let l = textureSampleLevel(still, lin, q, 0.0);
        if (P.flash.w > 0.0 && lit > 0.01) {
          // the fine shade: the way the light comes from, and what stands that way close by
          let h = 1.0 / vec3f(textureDimensions(glowA));
          let g = vec3f(
            dot(textureSampleLevel(glowA, lin, q + vec3f(h.x, 0.0, 0.0), 0.0), P.shine[0]),
            dot(textureSampleLevel(glowA, lin, q + vec3f(0.0, h.y, 0.0), 0.0), P.shine[0]),
            dot(textureSampleLevel(glowA, lin, q + vec3f(0.0, 0.0, h.z), 0.0), P.shine[0])) - vec3f(dot(a, P.shine[0]));
          let to = g / max(length(g), 1e-5);
          let w = P.thick.w;
          let dark = (fine(p + to * w * 0.35) * 0.5 + fine(p + to * w) * 0.8 + density(p + to * w * 2.2, 1.0) * 1.2) * w * P.thick.x;
          lit *= mix(1.0, 0.13 + 1.9 * exp(-dark * 0.5), P.flash.w);
        }
        let source = P.flash.rgb * lit + P.moonTone.rgb * l.x + P.skyTone.rgb * l.y;
        let through = exp(-ext * step);
        // (the far goes into the dark)
        col += left * (1.0 - through) * source * exp(-t * P.fray.w);
        left *= through;
        if (left < 0.008) { left = 0.0; break; }
      }
      t += step;
    }
  }
  return vec4f(col, left);
}

// ---- the bolts ----

struct Piece { a: vec4f, b: vec4f };
@group(0) @binding(9) var<storage, read> pieces: array<Piece>;
struct Wire { glow: vec4f, time: vec4f }; // the stroke: how far up it has come, how bright; the leader: how far down, how bright
@group(0) @binding(10) var<uniform> W: array<Wire, 2>;
struct Ribbon {
  @builtin(position) at: vec4f,
  @location(0) side: vec2f, // across, and the core's share of the width
  @location(1) bright: vec2f, // core, skin
};
@vertex
fn ribbon(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Ribbon {
  var out: Ribbon;
  let c = v % 10u;
  let k = (v / 10u) % 10u; // (which of the two, and which time round: told by the first vertex drawn)
  let over = vec3f(0.0, 0.0, (f32(v / 100u) - 1.0) * P.box.z * 2.0);
  let A = pieces[i].a;
  let Z = pieces[i].b;
  let lum = abs(A.w);
  let main = A.w > 0.0;
  let w = W[k];
  var glow = w.glow.y * smoothstep(w.glow.x - 0.04, w.glow.x + 0.02, Z.w) * select(P.wire.y * lum, 1.0, main);
  if (Z.w < w.time.x) { glow += w.time.y * select(lum * 1.5, 1.0, main) * (0.1 + exp((Z.w - w.time.x) * 45.0)); }
  out.at = vec4f(2.0, 2.0, 2.0, 1.0);
  if (glow < 0.0015) { return out; }
  let end = (c == 1u || c == 2u || c == 4u);
  let side = select(-1.0, 1.0, c == 2u || c == 4u || c == 5u);
  let source = A.xyz + over - P.eye.xyz;
  let to = Z.xyz + over - P.eye.xyz;
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
  let core = sqrt(r * r / (z * z * px * px) + 0.3); // in pixels
  let wide = core * 2.2 + P.wire.z * r / (z * px) * 3.0 + 1.0;
  let pt = mix(a, b, f32(end)) + (vec2f(-along.y, along.x) * side + along * select(-0.25, 0.25, end)) * wide;
  // how much of it gets through the cloud before it
  let p = mix(A.xyz, Z.xyz, f32(end)) + over;
  let d = normalize(P.eye.xyz - p);
  var deep = 0.0;
  let n = 64;
  let far = min(span(p, d).y, length(P.eye.xyz - p));
  glow *= smoothstep(0.5, 1.9, length(P.eye.xyz - p)); // (not in one's face)
  for (var s = 0; s < n; s++) {
    let x = (f32(s) + 0.5) / f32(n);
    deep += fine(p + d * far * x * x) * 2.0 * x;
  }
  let through = exp(-deep * far / f32(n) * P.thick.x - length(P.eye.xyz - p) * P.fray.w);
  out.at = vec4f(pt / half, 0.5, 1.0);
  out.side = vec2f(side * wide, core);
  out.bright = vec2f(glow * through * min(1.0, r / (z * px) / core), glow * through * sqrt(lum));
  return out;
}
@fragment
fn spark(in: Ribbon) -> @location(0) vec4f {
  let x = in.side.x / in.side.y;
  let skin = exp(-abs(in.side.x) / (in.side.y * P.wire.z)) * 0.06;
  return vec4f(P.hot.rgb * in.bright.x * exp(-x * x) + P.skin.rgb * in.bright.y * skin, 1.0);
}

// ---- putting it together, a slice at a time, the most of everything that is there ----

struct Stamp {
  x: vec4f, // its own axes, as the world's; and which cloud
  y: vec4f, // and how strong
  z: vec4f, // and the most its picture means
  at: vec4f, // its middle, and how large
  half: vec4f, // half of it, at size 1; and 1 if it is of the face
};
struct Slice { z: f32, many: f32, pad0: f32, pad1: f32, face: vec4f, faceHalf: vec4f }; // the face: middle, size; half its box, and how far in its flesh stays
@group(0) @binding(11) var<uniform> S: Slice;
@group(0) @binding(12) var cloud0: texture_3d<f32>;
@group(0) @binding(13) var cloud1: texture_3d<f32>;
@group(0) @binding(14) var cloud2: texture_3d<f32>;
@group(0) @binding(15) var cloud3: texture_3d<f32>;
@group(0) @binding(23) var<storage, read> stamps: array<Stamp>;
@group(0) @binding(24) var skin: texture_3d<f32>;
fn cloudAt(k: i32, q: vec3f) -> f32 {
  switch k {
    case 0: { return textureSampleLevel(cloud0, lin, q, 0.0).r; }
    case 1: { return textureSampleLevel(cloud1, lin, q, 0.0).r; }
    case 2: { return textureSampleLevel(cloud2, lin, q, 0.0).r; }
    default: { return textureSampleLevel(cloud3, lin, q, 0.0).r; }
  }
}
fn around(z: f32) -> f32 { // the nearest time round
  let l = P.box.z * 2.0;
  return z - l * round(z / l);
}
fn slicePlace(at: vec2f) -> vec3f {
  let n = round(P.box.xyz * 2.0 / P.box.w);
  return (vec3f(at, S.z + 0.5) / n * 2.0 - 1.0) * P.box.xyz;
}
// the eyes and the mouth are kept open, in the face's own measure
fn open(p: vec3f) -> f32 {
  let q = vec3f(p.xy - S.face.xy, around(p.z - S.face.z)) / S.face.w;
  // (raggedly)
  let rag = textureSampleLevel(grain, rep, p * 0.6, 0.0);
  let r = 0.07 * (rag.x - 0.45) + 0.05 * (rag.y - 0.45);
  let e = vec3f((abs(q.x) - 0.37) * 1.0, (q.y - 0.25) * 1.12, (q.z - 0.86) * 0.8);
  let m = vec3f(q.x * 0.34, (q.y + 0.7 - 0.45 * q.x * q.x) * 1.5, (q.z - 0.75) * 0.28);
  return smoothstep(0.19, 0.27, length(e) + r) * smoothstep(0.05, 0.12, length(m) + r * 0.5);
}
// nothing at the block's sides
fn walls(p: vec3f) -> f32 {
  let e = min(p.xy + P.box.xy, P.box.xy - p.xy);
  return smoothstep(0.0, 0.2, min(e.x, e.y));
}
struct Quad { @builtin(position) at: vec4f, @location(0) @interpolate(flat) i: u32 };
@vertex
fn stampQuad(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Quad {
  let s = stamps[i];
  let p = slicePlace(vec2f(0.0));
  let r = length(s.half.xyz) * s.at.w;
  let dz = around(p.z - s.at.z);
  var out: Quad;
  out.i = i;
  out.at = vec4f(2.0, 2.0, 0.0, 1.0);
  if (abs(dz) < r) {
    let c = vec2f(f32(v == 1u || v == 2u || v == 4u), f32(v == 2u || v == 4u || v == 5u)) * 2.0 - 1.0;
    let q = (s.at.xy + c * sqrt(r * r - dz * dz)) / P.box.xy;
    out.at = vec4f(q.x, -q.y, 0.0, 1.0); // (the picture's rows go up the block)
  }
  return out;
}
@fragment
fn stamp(in: Quad) -> @location(0) vec4f {
  let s = stamps[in.i];
  let p = slicePlace(in.at.xy);
  let q = vec3f(p.xy - s.at.xy, around(p.z - s.at.z));
  let u = vec3f(dot(q, s.x.xyz), dot(q, s.y.xyz), dot(q, s.z.xyz)) / (s.half.xyz * s.at.w) * 0.5 + 0.5;
  if (any(u < vec3f(0.0)) || any(u > vec3f(1.0))) { discard; }
  let v = cloudAt(i32(s.x.w), u);
  var d = v * v * s.z.w * s.y.w * walls(p);
  if (s.half.w > 0.5) { d *= open(p); }
  return vec4f(sqrt(clamp(d, 0.0, 1.0)), 0.0, 0.0, 1.0);
}
@fragment
fn flesh(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let p = slicePlace(at.xy);
  let q = vec3f(p.xy - S.face.xy, around(p.z - S.face.z)) / S.face.w;
  // (her muzzle a little wider than it is)
  let wide = vec3f(mix(1.0, 0.78, smoothstep(-0.15, -0.45, q.y)), 1.0, 1.0);
  let u = q * wide / S.faceHalf.xyz * 0.5 + 0.5;
  if (any(u < vec3f(0.0)) || any(u > vec3f(1.0))) { discard; }
  var far = textureSampleLevel(skin, lin, u, 0.0).r * 0.4; // (signed)
  // it swells in rounds: large, middling, small, each set on the last
  let w = (textureSampleLevel(grain, rep, p * 0.21 + 0.3, 0.0).xyz - 0.5) * 0.3;
  let a = textureSampleLevel(grain, rep, p * S.pad0 + w * 0.2, 0.0).x;
  let b = textureSampleLevel(grain, rep, p * S.pad0 * 2.3 + w * 0.3 + 0.4, 0.0).x;
  let c = textureSampleLevel(grain, rep, p * S.pad0 * 2.6 + 0.7, 0.0).y;
  far -= S.pad1 * ((0.52 - a) * 1.0 + (0.52 - b) * 0.5 + (0.52 - c) * 0.3);
  // hollow, but for wisps
  let deep = textureSampleLevel(skin, lin, u, 0.0).r * 0.4 - 0.05 * (a - 0.5);
  let hollow = mix(0.003 + 0.1 * smoothstep(0.45, 0.2, b) * smoothstep(0.5, 0.25, a), 1.0, smoothstep(-0.21, -0.1, deep));
  let d = 0.14 * smoothstep(0.0, -0.035, far + S.faceHalf.w) * open(p) * hollow;
  return vec4f(sqrt(d), 0.0, 0.0, 1.0);
}
@group(0) @binding(16) var below: texture_3d<f32>;
@fragment
fn shrink(@builtin(position) at: vec4f) -> @location(0) vec4f {
  // (the mean of the density, not of its root)
  var sum = 0.0;
  for (var i = 0; i < 8; i++) {
    let v = textureLoad(below, vec3i(vec2i(at.xy) * 2, i32(S.z) * 2) + vec3i(i & 1, (i >> 1) & 1, i >> 2), 0).r;
    sum += v * v;
  }
  return vec4f(sqrt(sum / 8.0), 0.0, 0.0, 1.0);
}
@fragment
fn roughen(@builtin(position) at: vec4f) -> @location(0) vec4f {
  // of the picture two sizes down, the most in two texels and one round them
  let n = vec3i(textureDimensions(below));
  let c = vec3i(vec2i(at.xy), i32(S.z)) * 2;
  var most = 0.0;
  for (var z = -2; z < 4; z++) { for (var y = -2; y < 4; y++) { for (var x = -2; x < 4; x++) {
    most = max(most, textureLoad(below, vec3i(clamp(c.xy + vec2i(x, y), vec2i(0), n.xy - 1), (c.z + z + n.z) % n.z), 0).r);
  } } }
  return vec4f(most * 6.0, 0.0, 0.0, 1.0);
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
  let index = id.x + K.turn * 262144u;
  seed = scramble(index ^ 0x5bd1e995u);
  let k = min(u32(unit01(index * 3679390609u) * f32(K.many)), K.many - 1u) + K.first;
  let A = pieces[k].a;
  let Z = pieces[k].b;
  var p = mix(A.xyz, Z.xyz, rnd());
  let channel = min(u32(Z.w * 4.0), 3u);
  let worth = length(Z.xyz - A.xyz) / K.mean * 64.0;
  var d = anyway();
  var want = -log(max(rnd(), 1e-6));
  let size = vec3f(K.size.xyz);
  let step = P.box.w * 4.0;
  for (var i = 0; i < 900; i++) {
    p += d * step;
    if (any(abs(p.xy) > P.box.xy)) { return; }
    let c = vec3u(fract(place(p)) * size);
    atomicAdd(&tallied[((c.z * K.size.y + c.y) * K.size.x + c.x) * 4u + channel], u32(worth));
    let ext = density(p, 2.0) * P.thick.x * P.thick.y;
    want -= ext * step;
    if (want < 0.0) {
      d = anyway();
      want = -log(max(rnd(), 1e-6));
    }
  }
}
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
      let q = vec3i(p.xy + vec2i(x, y), (p.z + z + n.z) % n.z);
      if (any(q.xy < vec2i(0)) || any(q.xy >= n.xy)) { continue; }
      let i = u32((q.z * n.y + q.y) * n.x + q.x) * 4u;
      let w = exp(-f32(x * x + y * y + z * z) * 0.5);
      sum += w * vec4f(f32(done[i]), f32(done[i + 1u]), f32(done[i + 2u]), f32(done[i + 3u]));
      area += w;
    } } }
    if (r > 0 && dot(sum, vec4f(1.0)) > 64.0 * 900.0) { break; }
  }
  textureStore(made, p, sum / area * K.worth);
}
@compute @workgroup_size(4, 4, 4)
fn moonlight(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(K.size.xyz);
  let c = vec3i(id);
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
      deep += density(p + d * far * x * x, 1.0) * 2.0 * x;
    }
    deep *= far / 40.0 * P.thick.x;
    // what is turned aside is not lost: some of it comes all the same
    let t = 0.55 * exp(-deep) + 0.3 * exp(-deep * 0.35) + 0.15 * exp(-deep * 0.1);
    if (k == 0) { out.x = t; } else { out.y += t / 6.0; }
  }
  textureStore(made, c, out);
}

// ---- the clouds over the sky, at full size ----

@group(0) @binding(22) var marched: texture_2d<f32>;
@fragment
fn over(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = at.xy / P.more.xy;
  let h = 0.5 / vec2f(textureDimensions(marched));
  var c = vec4f(0.0);
  for (var i = 0; i < 4; i++) { c += 0.25 * textureSampleLevel(marched, lin, uv + h * vec2f(f32(i & 1) * 2.0 - 1.0, f32(i >> 1) * 2.0 - 1.0), 0.0); }
  let q = (uv * 2.0 - 1.0) * vec2f(1.0, -1.0);
  let d = normalize(P.fore.xyz + P.right.xyz * q.x + P.up.xyz * q.y);
  return vec4f(c.rgb + c.a * sky(d), 1.0);
}
