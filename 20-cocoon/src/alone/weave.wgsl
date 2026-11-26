// The web's strands (tear.ts), each a few times over: the chain between its moments and its nodes, and the frizz the
// chain is too coarse for, more of it where the silk is slack.
struct Weave { n: u32, copies: u32, frames: u32, nodes: u32, points: u32, out: u32, data: u32, round: u32, when: vec4f, look: vec4f, at: vec4f }
@group(0) @binding(0) var<uniform> w: Weave;
@group(0) @binding(1) var<storage, read> motion: array<vec2u>;
@group(0) @binding(2) var<storage, read> length_: array<f32>;
@group(0) @binding(3) var<storage, read_write> points: array<vec4f>;

fn node(s: u32, f: i32, k: i32) -> vec3f {
  var m = u32(clamp(f, 0, i32(w.frames) - 1));
  if (w.round > 0u) { m = u32((f + i32(w.frames) * 2) % i32(w.frames)); }
  let q = motion[w.data + (s * w.frames + m) * w.nodes + u32(clamp(k, 0, i32(w.nodes) - 1))];
  return vec3f(f32(extractBits(i32(q.x), 0u, 16u)), f32(extractBits(i32(q.x), 16u, 16u)), f32(extractBits(i32(q.y), 0u, 16u))) * w.look.x;
}
fn moment(s: u32, at: f32, k: i32) -> vec3f {
  let f = floor(at);
  let t = at - f;
  let i = i32(f);
  let a = node(s, i - 1, k); let b = node(s, i, k); let c = node(s, i + 1, k); let d = node(s, i + 2, k);
  return b + 0.5 * t * (c - a + t * (2.0 * a - 5.0 * b + 4.0 * c - d + t * (3.0 * (b - c) + d - a)));
}
fn hash(x: u32) -> f32 {
  var h = x * 0x8da6b343u;
  h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u;
  return f32(h) / 4294967296.0;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let at = id.x;
  if (at >= w.n * w.copies * w.points) { return; }
  let i = at / w.points;
  let j = at - i * w.points;
  let copy = i / w.n;
  let s = i - copy * w.n;
  let when = w.when.x;
  let u = f32(j) / f32(w.points - 1u);
  let x = u * f32(w.nodes - 1u);
  let k = min(i32(x), i32(w.nodes) - 2);
  let t = x - f32(k);
  let b = moment(s, when, k); let c = moment(s, when, k + 1);
  var a = moment(s, when, k - 1); var d = moment(s, when, k + 2);
  if (k == 0) { a = 2.0 * b - c; }
  if (k == i32(w.nodes) - 2) { d = 2.0 * c - b; }
  var p = b + 0.5 * t * (c - a + t * (2.0 * a - 5.0 * b + 4.0 * c - d + t * (3.0 * (b - c) + d - a)));
  // how stretched it is here
  let seg = length_[s] / f32(w.nodes - 1u);
  let r = mix(mix(length(b - a), length(c - b), min(t + 0.5, 1.0)), length(d - c), max(t - 0.5, 0.0)) / seg;
  let slack = clamp((1.16 - r) * 2.6, 0.06, 1.35) * w.look.y;
  let arc = u * length_[s];
  var fr = vec3f(0.0);
  for (var o = 0u; o < 4u; o++) {
    let amp = vec4f(0.016, 0.011, 0.0065, 0.003)[o];
    let wl = vec4f(0.46, 0.24, 0.135, 0.10)[o];
    for (var e = 0u; e < 3u; e++) {
      let h = hash((s * 8u + copy) * 64u + o * 4u + e);
      fr[e] += amp * sin(6.2831853 * (arc / (wl * (0.7 + 0.6 * h)) + 17.0 * fract(h * 91.7)));
    }
  }
  fr *= 0.5 + 1.6 * hash((s * 8u + copy) * 64u + 63u);
  p += fr * slack * sqrt(max(sin(3.14159265 * u), 0.0));
  // its copies: not quite the same way
  let mine = s * 4u + copy + 7919u;
  let away = vec3f(hash(mine) - 0.5, hash(mine + 4001u) - 0.5, hash(mine + 8009u) - 0.5) * w.look.w;
  p += away * sin(3.14159265 * u) + w.at.xyz;
  // its ends are tied, or torn: those fray to nothing
  points[w.out + at] = vec4f(p, w.look.z * (1.0 - 0.7 * smoothstep(0.75, 1.0, u)));
}
