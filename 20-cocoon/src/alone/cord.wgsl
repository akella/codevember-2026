// The threads: held at the top, turned with the cocoon below (less and less above), rocking with it at the neck.
struct Cord { first: u32, count: u32, out: u32, rest: u32, spin: vec4f, sway: mat3x4f, rock: mat3x4f }
@group(0) @binding(0) var<uniform> cord: Cord;
@group(0) @binding(1) var<storage, read_write> points: array<vec4f>;
fn by(m: mat3x4f, p: vec3f) -> vec3f { return vec3f(dot(m[0].xyz, p) + m[0].w, dot(m[1].xyz, p) + m[1].w, dot(m[2].xyz, p) + m[2].w); }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= cord.count) { return; }
  let q = points[cord.first + id.x];
  let neck = cord.spin.y;
  let top = cord.spin.z;
  let f = clamp((top - q.y) / (top - neck), 0.0, 1.0);
  let a = cord.spin.x * f;
  let c = cos(a);
  let s = sin(a);
  // wound about one another (spin.w), two cords draw together, tightest half way down
  let tight = 1.0 - cord.spin.w * (1.0 - exp(-abs(cord.spin.x) * 0.45)) * smoothstep(0.0, 0.16, f) * 0.9;
  var p = vec3f((c * q.x + s * q.z) * tight, q.y, (c * q.z - s * q.x) * tight);
  if (f >= 1.0) { p = vec3f(c * q.x + s * q.z, q.y, c * q.z - s * q.x); }
  p = mix(p, by(cord.rock, p), 1.0 - smoothstep(neck - 0.35, neck + 0.5, q.y));
  points[cord.out + id.x] = vec4f(by(cord.sway, p), q.w);
}
