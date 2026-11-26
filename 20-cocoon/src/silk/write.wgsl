// The strands of the thread, point by point: along the word or along the taut line, the pull running out from the
// middle; frayed and curling where it is slack, a cord where it is taut; moved by the air.
struct Write { n: u32, points: u32, out: u32, samples: u32, when: vec4f, look: vec4f }
@group(0) @binding(0) var<uniform> w: Write;
@group(0) @binding(1) var<storage, read> word: array<vec4f>;
@group(0) @binding(2) var<storage, read> taut: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> points: array<vec4f>;

fn hash(x: u32) -> f32 {
  var h = x * 0x8da6b343u;
  h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u;
  return f32(h) / 4294967296.0;
}
fn along(x: f32, pulled: f32) -> vec4f {
  let y = clamp(x, 0.0, 1.0) * f32(w.samples - 1u);
  let i = min(u32(y), w.samples - 2u);
  let f = y - f32(i);
  return mix(mix(word[i], word[i + 1u], f), mix(taut[i], taut[i + 1u], f), pulled);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let at = id.x;
  if (at >= w.n * w.points) { return; }
  let i = at / w.points;
  let j = at - i * w.points;
  let u = f32(j) / f32(w.points - 1u);
  // each strand a part of the whole, some long, some short
  let long = select(0.10 + 0.22 * hash(i * 7u + 1u), 1.0, i < 46u);
  let from_ = (1.0 - long) * hash(i * 7u + 2u);
  let s = from_ + u * long;
  // pulled from both ends: the middle comes last
  let late = 0.16 * (1.0 - abs(2.0 * s - 1.0));
  let k = clamp(w.when.x - late * 3.0 * max(w.when.x, 0.0) * (1.0 - w.when.x), -0.35, 1.0);
  let e = 1.0 / f32(w.samples);
  let c = along(s, k);
  let t = normalize(along(s + e, k).xyz - along(s - e, k).xyz + vec3f(1e-5, 0.0, 0.0));
  let a = normalize(cross(t, vec3f(0.13, 0.2, 0.97)));
  let b = cross(t, a);
  let slack = clamp(1.0 - 0.94 * max(k, 0.0), 0.0, 1.3);
  let core = select(0.0, 1.0, i < 46u);
  // a cord's twist, and what strays from it
  let turn = 6.2831853 * hash(i * 7u + 3u) + s * 520.0;
  let thick = (0.008 + 0.020 * sqrt(hash(i * 7u + 4u))) * mix(1.0, 1.6, slack);
  var o = a * cos(turn) * thick + b * sin(turn) * thick;
  let stray = slack * mix(1.0, 0.42, core) * (1.0 - 0.75 * smoothstep(0.35, 0.9, c.w));
  let arc = s * w.look.y;
  for (var q = 0u; q < 4u; q++) {
    let wl = vec4f(0.9, 0.38, 0.17, 0.08)[q];
    let amp = vec4f(0.060, 0.034, 0.016, 0.006)[q] * (0.3 + 1.4 * hash(i * 31u + q));
    let p1 = 6.2831853 * (arc / (wl * (0.8 + 0.4 * hash(i * 31u + q + 8u))) + hash(i * 31u + q + 16u));
    let p2 = 6.2831853 * (arc / (wl * (0.8 + 0.4 * hash(i * 31u + q + 24u))) + hash(i * 31u + q + 12u));
    o += stray * amp * (a * sin(p1) + b * sin(p2));
  }
  var p = c.xyz + o * smoothstep(0.0, 0.06, u + 1.0 - core + 0.06) ;
  // the air; and the hum when it comes taut
  let wind = w.look.z * slack * (0.35 + 1.3 * hash(i * 7u + 5u));
  let th = w.when.y;
  p += wind * vec3f(0.3 * sin(p.y * 2.1 + th * 2.0 + p.x), 0.35 * sin(p.x * 1.4 + th + 1.0), sin(p.x * 1.1 - th * 2.0 + p.y * 1.3));
  p.y += w.when.z * 0.05 * sin(p.x * 2.4) * sin(th * 60.0) * (1.0 - smoothstep(0.3, 0.9, c.w));
  // kept off the o's
  let end = abs(2.0 * u - 1.0);
  points[w.out + at] = vec4f(p, w.look.x * mix(0.8, 1.35, core) * (1.0 - mix(0.8, 0.0, core) * end * end * end));
}
