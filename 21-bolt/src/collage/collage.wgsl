// Clouds that happen to look like a head, from the front, and bolts through them. As head.wgsl, but there is no head:
// only whole VDB clouds, stamped where arrange.ts put them.

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
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var lin: sampler;
@group(0) @binding(2) var dense: texture_3d<f32>;
@group(0) @binding(3) var rough: texture_3d<f32>; // the most in each 8 voxels and round them
@group(0) @binding(4) var still: texture_3d<f32>; // the moon's light, the sky's
@group(0) @binding(5) var glow: texture_3d<f32>; // the light of the bolts, and how much that is
@group(0) @binding(7) var grain: texture_3d<f32>;
@group(0) @binding(8) var rep: sampler;

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}
fn place(p: vec3f) -> vec3f { return p / P.box.xyz * 0.5 + 0.5; }
fn density(p: vec3f, level: f32) -> f32 {
  let v = textureSampleLevel(dense, lin, place(p), max(level, P.hot.y)).r;
  return v * v;
}
// with its edges eaten into by finer stuff than the voxels hold
fn fine(p: vec3f) -> f32 {
  let d = density(p, 0.0);
  if (d < 0.002) { return 0.0; }
  // (two of it, going opposite ways: it boils)
  let n = textureSampleLevel(grain, rep, p * P.fray.y + vec3f(0.0, -P.fray.z, 0.0), 0.0).x;
  let m = textureSampleLevel(grain, rep, p * P.fray.y + vec3f(P.fray.z, 0.0, P.fray.z), 0.0).y;
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
  return P.skyTone.rgb * (0.16 + 0.5 * exp(-abs(up) * 5.0));
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
    // (a whole number of times round in a loop of 12 s)
    let w = max(1.0, round(sqrt(k) * 1.3 * 12.0 / 6.2831853)) * 6.2831853 / 12.0;
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
fn cloud(o: vec3f, d: vec3f, jump: f32, cheap: bool) -> vec4f {
  let s = span(o, d);
  var col = vec3f(0.0);
  var left = 1.0;
  if (s.y > s.x) {
    let step = P.thick.z * select(1.0, 1.5, cheap);
    var t = s.x + step * jump;
    for (var i = 0; i < 520 && t < s.y; i++) {
      let p = o + d * t;
      let most = textureSampleLevel(rough, lin, place(p), 0.0).r;
      if (most < 0.004) {
        t += P.box.w * 5.0;
        continue;
      }
      let v = fine(p);
      if (v > 0.001) {
        let ext = v * P.thick.x;
        let q = place(p);
        let g = textureSampleLevel(glow, lin, q, 0.0);
        var lit = 1.0;
        let l = textureSampleLevel(still, lin, q, 0.0);
        if (P.fray.w > 0.0 && g.a > 0.01 && !cheap) {
          // the fine shade: the way the light comes from, and what stands that way close by
          let h = 1.0 / vec3f(textureDimensions(glow));
          let up = vec3f(
            textureSampleLevel(glow, lin, q + vec3f(h.x, 0.0, 0.0), 0.0).a,
            textureSampleLevel(glow, lin, q + vec3f(0.0, h.y, 0.0), 0.0).a,
            textureSampleLevel(glow, lin, q + vec3f(0.0, 0.0, h.z), 0.0).a) - g.a;
          let to = up / max(length(up), 1e-5);
          let w = P.thick.w;
          let dark = (fine(p + to * w * 0.35) * 0.5 + fine(p + to * w) * 0.8 + density(p + to * w * 2.2, 1.0) * 1.2) * w * P.thick.x;
          lit = mix(1.0, 0.13 + 1.9 * exp(-dark * 0.5), P.fray.w);
        }
        let source = g.rgb * lit + P.moonTone.rgb * l.x + P.skyTone.rgb * l.y;
        let through = exp(-ext * step);
        col += left * (1.0 - through) * source;
        left *= through;
        if (left < 0.008) { left = 0.0; break; }
      }
      t += step;
    }
  }
  return vec4f(col, left);
}
@fragment
fn march(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = (at.xy / P.size.xy * 2.0 - 1.0) * vec2f(1.0, -1.0);
  let o = P.eye.xyz;
  let d = normalize(P.fore.xyz + P.right.xyz * uv.x + P.up.xyz * uv.y);
  let jump = fract(52.9829189 * fract(dot(floor(at.xy), vec2f(0.06711056, 0.00583715))));
  var c = cloud(o, d, jump, false);
  if (P.seaMore.w > 0.0 && d.y < 0.0 && c.a > 0.004) {
    // the water: what is above it, by its waves, and its own dark (the bolts in it are added at full size, in over)
    let w = wet(o, d, P.size.z);
    let back = cloud(w.at, w.r, jump, true);
    c = vec4f(c.rgb + c.a * (w.f * P.sea.w * (back.rgb + back.a * sky(w.r)) + P.seaMore.rgb), c.a);
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
fn ribbonOf(v: u32, i: u32, sea: bool) -> Ribbon {
  var out: Ribbon;
  let c = v % 10u;
  let k = v / 10u; // (which of them: told by the first vertex drawn)
  var A = pieces[i].a;
  var Z = pieces[i].b;
  let real = mat2x3f(A.xyz, Z.xyz);
  if (sea) {
    A.y = 2.0 * P.sea.x - A.y;
    Z.y = 2.0 * P.sea.x - Z.y;
  }
  let lum = abs(A.w);
  let main = A.w > 0.0;
  let w = W[k];
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
  // how much of it gets through the cloud before it (in the water: on its way down to the water and up to the eye,
  // as straight as from the eye's own image under the water)
  let p = mix(real[0], real[1], f32(end));
  let eye = select(P.eye.xyz, vec3f(P.eye.x, 2.0 * P.sea.x - P.eye.y, P.eye.z), sea);
  let d = normalize(eye - p);
  var deep = 0.0;
  let n = 64;
  let far = min(span(p, d).y, length(eye - p));
  fire *= smoothstep(0.05, 0.4, length(eye - p)); // (not in one's face)
  for (var s = 0; s < n; s++) {
    let x = (f32(s) + 0.5) / f32(n);
    deep += fine(p + d * far * x * x) * 2.0 * x;
  }
  let through = exp(-deep * far / f32(n) * P.thick.x);
  out.at = vec4f(pt / half, 0.5, 1.0);
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

// ---- putting it together, a slice at a time, the most of everything that is there ----

struct Stamp {
  x: vec4f, // its own axes, as the world's; and which cloud
  y: vec4f, // and how strong
  z: vec4f, // and the most its picture means
  at: vec4f, // its middle, and how large
  half: vec4f, // half of it, at size 1; and how worn its base is
};
struct Slice {
  z: f32, swellSize: f32, swell: f32, body: f32, // which; how fine the skin's swelling is, how far it goes; how dense she is
  half: vec4f, // of her box; how far in from her skin she is solid
  carve: vec4f, // the eyes, the mouth, how ragged they are; how wide her muzzle
  inside: vec4f, // how hollow, how thick the wall is, wisps in there; how soft her edge
  clump: vec4f, // how clumpy she is, and how fine that; voxels a texel
};
@group(0) @binding(11) var<uniform> S: Slice;
@group(0) @binding(12) var cloud0: texture_3d<f32>;
@group(0) @binding(13) var cloud1: texture_3d<f32>;
@group(0) @binding(14) var cloud2: texture_3d<f32>;
@group(0) @binding(15) var cloud3: texture_3d<f32>;
@group(0) @binding(32) var cloud4: texture_3d<f32>;
@group(0) @binding(33) var cloud5: texture_3d<f32>;
@group(0) @binding(34) var cloud6: texture_3d<f32>;
@group(0) @binding(35) var cloud7: texture_3d<f32>;
@group(0) @binding(36) var cloud8: texture_3d<f32>;
@group(0) @binding(37) var cloud9: texture_3d<f32>;
@group(0) @binding(23) var<storage, read> stamps: array<Stamp>;
fn cloudAt(k: i32, q: vec3f) -> f32 {
  switch k {
    case 0: { return textureSampleLevel(cloud0, lin, q, 0.0).r; }
    case 1: { return textureSampleLevel(cloud1, lin, q, 0.0).r; }
    case 2: { return textureSampleLevel(cloud2, lin, q, 0.0).r; }
    case 3: { return textureSampleLevel(cloud3, lin, q, 0.0).r; }
    case 4: { return textureSampleLevel(cloud4, lin, q, 0.0).r; }
    case 5: { return textureSampleLevel(cloud5, lin, q, 0.0).r; }
    case 6: { return textureSampleLevel(cloud6, lin, q, 0.0).r; }
    case 7: { return textureSampleLevel(cloud7, lin, q, 0.0).r; }
    case 8: { return textureSampleLevel(cloud8, lin, q, 0.0).r; }
    default: { return textureSampleLevel(cloud9, lin, q, 0.0).r; }
  }
}
fn slicePlace(at: vec2f) -> vec3f {
  let n = round(P.box.xyz * 2.0 / P.box.w / S.clump.z);
  return (vec3f(at, S.z + 0.5) / n * 2.0 - 1.0) * P.box.xyz;
}
// nothing at the block's sides
fn walls(p: vec3f) -> f32 {
  let e = P.box.xyz - abs(p);
  return smoothstep(0.0, 0.12, min(e.x, min(e.y, e.z)));
}
struct Quad { @builtin(position) at: vec4f, @location(0) @interpolate(flat) i: u32 };
@vertex
fn stampQuad(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Quad {
  let s = stamps[i];
  let p = slicePlace(vec2f(0.0));
  let r = length(s.half.xyz) * s.at.w;
  let dz = p.z - s.at.z;
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
  let q = p - s.at.xyz;
  let u = vec3f(dot(q, s.x.xyz), dot(q, s.y.xyz), dot(q, s.z.xyz)) / (s.half.xyz * s.at.w) * 0.5 + 0.5;
  if (any(u < vec3f(0.0)) || any(u > vec3f(1.0))) { discard; }
  let v = cloudAt(i32(s.x.w), u);
  // (its flat base worn ragged, by billows coming up from below)
  let n = textureSampleLevel(grain, rep, p * 1.3, 0.0);
  let worn = smoothstep(0.0, 0.25, u.y - s.half.w * (1.4 * n.x + 0.6 * n.y - 0.75));
  var d = v * v * s.z.w * s.y.w * walls(p) * mix(1.0, worn, step(0.001, s.half.w));
  return vec4f(sqrt(clamp(d, 0.0, 1.0)), 0.0, 0.0, 1.0);
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
    most = max(most, textureLoad(below, clamp(c + vec3i(x, y, z), vec3i(0), n - 1), 0).r);
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
  if (any(abs(p) > P.box.xyz)) { // (from outside: it starts where it comes in)
    let s = span(p, d);
    if (s.y <= s.x) { return; }
    p += d * s.x;
  }
  let size = vec3f(K.size.xyz);
  let step = P.box.w * 4.0;
  for (var i = 0; i < 900; i++) {
    p += d * step;
    if (any(abs(p) >= P.box.xyz)) { return; }
    let c = vec3u(place(p) * size);
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
      let q = p + vec3i(x, y, z);
      if (any(q < vec3i(0)) || any(q >= n)) { continue; }
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

// ---- the light of all the bolts, a frame's ----

struct Gather { shine: array<vec4f, 6>, tone: array<vec4f, 6>, near: vec4f }; // how bright each quarter of each is; its colour; how white the light is close by
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
    let lit = dot(glowAt(k, id), G.shine[k]);
    out += lit * vec4f(mix(G.tone[k].rgb, vec3f(1.0), G.near.x * lit / (lit + G.near.y)), 1.0);
  }
  textureStore(made, id, out);
}

// ---- the clouds over the sky, at full size ----

@group(0) @binding(22) var marched: texture_2d<f32>;
@group(0) @binding(38) var mirrored: texture_2d<f32>; // the bolts, upside down under the water
@fragment
fn over(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = at.xy / P.more.xy;
  let h = 0.5 / vec2f(textureDimensions(marched));
  var c = vec4f(0.0);
  for (var i = 0; i < 4; i++) { c += 0.25 * textureSampleLevel(marched, lin, uv + h * vec2f(f32(i & 1) * 2.0 - 1.0, f32(i >> 1) * 2.0 - 1.0), 0.0); }
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
  return vec4f(c.rgb + c.a * sky(d), 1.0);
}
