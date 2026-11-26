// The cocoons' relief, as bake/cocoon.py makes it, from the same noise.
struct Made { wave: f32, high: f32, ring: f32, seed: u32, A: f32, B: f32, p: f32, layer: u32, lo: f32, hi: f32, style: u32, pad: u32 }
@group(0) @binding(0) var<uniform> made: Made;
@group(0) @binding(1) var<storage, read_write> field: array<vec4f>;      // height, thickness, height blurred (round, then also along)
const NU = 1536u;
const NV = 768u;
const PI = 3.14159265359;

fn grad(i: vec3i, f: vec3f, seed: u32) -> f32 {
  var h = (bitcast<u32>(i.x) * 0x8DA6B343u) ^ (bitcast<u32>(i.y) * 0xD8163841u) ^ (bitcast<u32>(i.z) * 0xCB1AB31Fu) ^ (seed * 0x9E3779B1u);
  h ^= h >> 16u; h *= 0x7FEB352Du; h ^= h >> 15u; h *= 0x846CA68Bu; h ^= h >> 16u;
  let g = vec3f(f32(h & 1023u), f32((h >> 10u) & 1023u), f32((h >> 20u) & 1023u)) / 511.5 - 1.0;
  return dot(g, f);
}
fn noise(p: vec3f, seed: u32) -> f32 {
  let fl = floor(p);
  let i = vec3i(fl);
  let f = p - fl;
  let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var o = 0.0;
  for (var c = 0; c < 8; c++) {
    let k = vec3i(c & 1, (c >> 1) & 1, c >> 2);
    let b = vec3f(k);
    let m = mix(1.0 - w, w, b);
    o += grad(i + k, f - b, seed) * m.x * m.y * m.z;
  }
  return o * 1.5;
}
fn noise3(p: vec3f, seed: u32) -> vec3f { return vec3f(noise(p, seed + 1u), noise(p, seed + 18u), noise(p, seed + 35u)); }
fn direction(u: f32, v: f32) -> vec3f {
  let phi = u * 2.0 * PI;
  let th = v * PI;
  return vec3f(cos(th), sin(th) * cos(phi), sin(th) * sin(phi));
}
fn radial(d: vec3f) -> f32 {
  let rho = sqrt(d.y * d.y + d.z * d.z);
  let t = d.x / 0.42;
  let w = (1.0 + 0.05 * d.x) * (1.0 - 0.022 * exp(-t * t));
  return pow(pow(abs(d.x) / made.A, made.p) + pow(rho / (made.B * w), made.p), -1.0 / made.p);
}
fn smooth_(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }

@compute @workgroup_size(8, 8)
fn crinkle(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= NU || id.y >= NV) { return; }
  let d = direction((f32(id.x) + 0.5) / f32(NU), (f32(id.y) + 0.5) / f32(NV));
  let p = d * radial(d);
  let s = made.seed;
  let q = p * vec3f(made.ring, 1.0, 1.0) / sqrt(made.ring);
  let w = made.wave;
  let warp = noise3(q / (w * 2.1), s + 1u) * w * 0.42 + noise3(q / (w * 0.8), s + 2u) * w * 0.16;
  if (made.style == 2u) {
    // the studio's (bake/studio.py): worms, ridges with round backs, drawn out along or round it patch by patch
    let warp2 = noise3(p / (w * 3.4), s + 1u) * w * 0.80 + noise3(p / (w * 1.3), s + 2u) * w * 0.36;
    let along = smooth_(-0.35, 0.35, noise(p / 0.45, s + 14u));
    let q1 = (p + warp2) * vec3f(0.62, 1.1, 1.1);
    let q2 = (p + warp2) * vec3f(1.25, 0.82, 0.82);
    let b1 = noise(q1 / w, s + 3u) * 3.1;
    let b2 = noise(q2 / w, s + 23u) * 3.1;
    let s1 = noise(q1 * 1.75 / w, s + 4u) * 2.8;
    let s2 = noise(q2 * 1.75 / w, s + 24u) * 2.8;
    let big = exp(-b1 * b1) * along + exp(-b2 * b2) * (1.0 - along);
    let small = exp(-s1 * s1) * along + exp(-s2 * s2) * (1.0 - along);
    let ridge = max(big, 0.72 * small) * 0.75 + 0.25 * (0.6 * big + 0.4 * small);
    let soft = 0.55 + 0.45 * smooth_(-0.5, 0.5, noise(p / 0.40, s + 6u));
    let lump_ = noise(p / 0.62, s + 7u) * 0.013 + noise(p / 0.27, s + 8u) * 0.006 + 0.0045 * noise(p / 0.095, s + 12u);
    let weave = 0.0009 * noise(p / 0.0105, s + 9u) + 0.0006 * noise(p / 0.0060, s + 10u);
    let t = clamp(0.55 + 0.22 * noise(p / 0.36, s + 11u) + 0.5 * (ridge - 0.5) + 0.10 * noise(p / 0.03, s + 13u), 0.0, 1.0);
    field[id.y * NU + id.x] = vec4f(lump_ + made.high * soft * 2.0 * (ridge - 0.5) + weave, t, 0.0, 0.0);
    return;
  }
  if (made.style == 1u) {
    // pebbled: winding ridges with rounded backs, two sizes of them, and no felt
    let r1 = noise((q + warp * 1.2) / w, s + 3u);
    let r2 = noise((q + warp * 0.9 + 3.1) / (w * 0.6), s + 4u);
    let ridge = exp(-r1 * r1 * 9.0) * 0.62 + exp(-r2 * r2 * 8.0) * 0.38;
    let soft = 0.75 + 0.25 * smooth_(-0.5, 0.6, noise(p / 0.42, s + 6u));
    let lump_ = noise(p / 0.55, s + 7u) * 0.012 + noise(p / 0.28, s + 8u) * 0.005;
    let t = clamp(0.5 + 0.2 * noise(p / 0.36, s + 11u) + 0.35 * (ridge - 0.5), 0.0, 1.0);
    field[id.y * NU + id.x] = vec4f(lump_ + made.high * soft * 2.0 * (ridge - 0.5), t, 0.0, 0.0);
    return;
  }
  let b1 = abs(noise((q + warp) / w, s + 3u));
  let b2 = abs(noise((q + warp * 0.8 + 3.1) / (w * 0.52), s + 4u));
  let b3 = noise((q + warp) / (w * 2.2), s + 5u);
  let crease = min(1.0, 1.9 * sqrt(b1 * b1 + 0.004)) * 0.62 + min(1.0, 1.7 * sqrt(b2 * b2 + 0.006)) * 0.38;
  let patch_ = 0.72 + 0.28 * smooth_(-0.5, 0.6, noise(p / 0.42, s + 6u));
  let lump = noise(p / 0.55, s + 7u) * 0.016 + noise(p / 0.28, s + 8u) * 0.006;
  let felt = noise(p / 0.026, s + 9u) * 0.55 + noise(p / 0.0125, s + 10u) * 0.45;
  let h = lump + made.high * patch_ * (2.2 * (crease - 0.62) + 0.45 * b3) + 0.0011 * felt;
  let thick = clamp(0.5 + 0.42 * noise(p / 0.36, s + 11u) + 0.30 * noise(p / 0.11, s + 12u) + 0.35 * (crease - 0.6) + 0.22 * noise(p / 0.035, s + 13u), 0.0, 1.0);
  field[id.y * NU + id.x] = vec4f(h, thick, 0.0, 0.0);
}

// blurred: a gaussian, round and then along
const SIGMA = 11.0;
fn weight(k: i32) -> f32 { let t = f32(k) / SIGMA; return exp(-0.5 * t * t); }
@compute @workgroup_size(8, 8)
fn blurRound(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= NU || id.y >= NV) { return; }
  var sum = 0.0;
  var all = 0.0;
  for (var k = -33; k <= 33; k++) {
    let x = u32(i32(id.x) + k + i32(NU)) % NU;
    sum += weight(k) * field[id.y * NU + x].x;
    all += weight(k);
  }
  field[id.y * NU + id.x].z = sum / all;
}
@compute @workgroup_size(8, 8)
fn blurAlong(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= NU || id.y >= NV) { return; }
  var sum = 0.0;
  var all = 0.0;
  for (var k = -33; k <= 33; k++) {
    let y = u32(clamp(i32(id.y) + k, 0, i32(NV) - 1));
    sum += weight(k) * field[y * NU + id.x].z;
    all += weight(k);
  }
  field[id.y * NU + id.x].w = sum / all;
}

// between the grid's points, round in u
fn lookup(u: f32, v: f32) -> vec4f {
  let x = u * f32(NU) - 0.5;
  let y = clamp(v * f32(NV) - 0.5, 0.0, f32(NV) - 1.001);
  let x0 = floor(x);
  let y0 = u32(floor(y));
  let f = vec2f(x - x0, y - floor(y));
  let a = u32(i32(x0) + i32(NU)) % NU;
  let b = (a + 1u) % NU;
  return mix(mix(field[y0 * NU + a], field[y0 * NU + b], f.x), mix(field[(y0 + 1u) * NU + a], field[(y0 + 1u) * NU + b], f.x), f.y);
}
fn place(u: f32, v: f32) -> vec3f { let d = direction(u, v); return d * (radial(d) + lookup(u, clamp(v, 0.0, 1.0)).x); }

// which way it faces, how far down a crease it is, how thick (cocoon.detail)
@group(0) @binding(2) var detailOut: texture_storage_2d_array<rgba8unorm, write>;
@compute @workgroup_size(8, 8)
fn detail(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(detailOut);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let u = (f32(id.x) + 0.5) / f32(size.x);
  let v = (f32(id.y) + 0.5) / f32(size.y);
  let eu = 0.6 / f32(size.x);
  let ev = 0.6 / f32(size.y);
  var n = normalize(cross(place(u, v + ev) - place(u, v - ev), place(u + eu, v) - place(u - eu, v)));
  let d = direction(u, v);
  if (dot(n, d) < 0.0) { n = -n; }
  let phi = u * 2.0 * PI;
  let sn = sqrt(max(1.0 - d.x * d.x, 0.0));
  let e1 = vec3f(0.0, -sin(phi), cos(phi));
  let e2 = vec3f(-sn, d.x * cos(phi), d.x * sin(phi));
  let k = lookup(u, v);
  textureStore(detailOut, id.xy, made.layer, vec4f(dot(n, e1) * 0.5 + 0.5, dot(n, e2) * 0.5 + 0.5, clamp((k.x - k.w) / 0.06 + 0.5, 0.0, 1.0), k.y));
}

// the shells' mesh: a little under the real one, so that the silk lying on it is never hidden; a byte a point
@group(0) @binding(3) var<storage, read_write> relief: array<u32>;
const MU = 512u;
const MV = 256u;
fn meshHeight(vi: u32) -> u32 {
  let u = f32(vi % MU) / f32(MU);
  let v = f32(vi / MU) / f32(MV);
  var least = 1e9;
  var sum = 0.0;
  for (var i = -1; i <= 1; i++) { for (var j = -1; j <= 1; j++) {
    let h = lookup(u + f32(i) / f32(MU) / 2.0, clamp(v + f32(j) / f32(MV) / 2.0, 0.0, 1.0)).x;
    least = min(least, h);
    sum += h;
  } }
  let r = least * 0.5 + sum / 18.0 - 0.0015;
  return u32(clamp(round((r - made.lo) / (made.hi - made.lo) * 255.0), 0.0, 255.0));
}
@compute @workgroup_size(64)
fn mesh(@builtin(global_invocation_id) id: vec3u) {
  let first = made.layer * MU * (MV + 1u);
  if (id.x * 4u >= MU * (MV + 1u)) { return; }
  var word = 0u;
  for (var b = 0u; b < 4u; b++) { word |= meshHeight(id.x * 4u + b) << (b * 8u); }
  relief[first / 4u + id.x] = word;
}

// smaller copies
@group(0) @binding(4) var from_: texture_2d_array<f32>;
@compute @workgroup_size(8, 8)
fn half_(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(detailOut);
  if (id.x >= size.x || id.y >= size.y) { return; }
  for (var l = 0u; l < 4u; l++) {
    let q = vec2i(id.xy) * 2;
    let c = textureLoad(from_, q, l, 0) + textureLoad(from_, q + vec2i(1, 0), l, 0) + textureLoad(from_, q + vec2i(0, 1), l, 0) + textureLoad(from_, q + vec2i(1, 1), l, 0);
    textureStore(detailOut, id.xy, l, c * 0.25);
  }
}
