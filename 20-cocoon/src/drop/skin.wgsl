// The strands that never let go: each point between what its two ends do.
struct Skin { first: u32, n: u32, points: u32, out: u32, mode: u32, a: u32, b: u32, fade: u32, look: vec4f }
struct Move { x: vec4f, y: vec4f, z: vec4f }
@group(0) @binding(0) var<uniform> s: Skin;
@group(0) @binding(1) var<uniform> moves: array<Move, 3>;
@group(0) @binding(2) var<storage, read_write> points: array<vec4f>;
fn go(m: u32, p: vec3f) -> vec3f { return vec3f(dot(moves[m].x.xyz, p) + moves[m].x.w, dot(moves[m].y.xyz, p) + moves[m].y.w, dot(moves[m].z.xyz, p) + moves[m].z.w); }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let at = id.x;
  if (at >= s.n * s.points) { return; }
  let j = at % s.points;
  let u = f32(j) / f32(s.points - 1u);
  let q = points[s.first + at];
  var p = q.xyz;
  var wide = q.w;
  if (s.mode == 0u) {
    p = mix(go(s.a, p), go(s.b, p), smoothstep(0.05, 0.95, u));
  } else {
    // the thread: held at the top, its knot moves
    let down = clamp((5.6 - p.y) / (5.6 - 3.55), 0.0, 1.0);
    let k = p + (go(2u, p) - p) * down;
    let t = clamp((u - 0.52) / 0.48, 0.0, 1.0);
    p = k;
    if (s.fade > 0u) { wide *= 1.0 - smoothstep(0.02, 0.30, t * 1.0); }
    else { p = mix(k, go(s.b, q.xyz), smoothstep(0.0, 1.0, t)); }
  }
  points[s.out + at] = vec4f(p, wide);
}
