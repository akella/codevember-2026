struct Frame {
  viewProj: mat4x4f,
  eye: vec4f,            // in the world
  size: vec4f,           // pixels, and how many pixels a unit is at distance 1
  spin: vec4f,           // how far the cluster has turned; the thread turns less and less above: from y, to y; fibre width
  misc: vec4f,           // the loop's angle; the lens: how wide it opens, what it is focused on
}
struct Shape { centre: vec4f, x: vec4f, y: vec4f, z: vec4f, abp: vec4f }
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> shapes: array<Shape, 4>;

// the thread is held at the top and turns with the cluster at the bottom
fn angleAt(y: f32) -> f32 { return frame.spin.x * smoothstep(frame.spin.y, frame.spin.z, y); }
fn turn(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * p.x + s * p.z, p.y, c * p.z - s * p.x); }

fn radial(s: Shape, d: vec3f) -> f32 {
  let rho = sqrt(d.y * d.y + d.z * d.z + 1e-12);
  let t = d.x / 0.42;
  let w = (1.0 + 0.05 * d.x) * (1.0 - 0.022 * exp(-t * t));
  return pow(pow(abs(d.x) / s.abp.x, s.abp.z) + pow(rho / (s.abp.y * w), s.abp.z), -1.0 / s.abp.z);
}

// the crinkled surface's normal (as the cluster hangs) at direction `own` of a cocoon's own frame, from what is known there
fn crinkled(s: Shape, own: vec3f, k: vec4f) -> vec3f {
  let sn = sqrt(max(1.0 - own.x * own.x, 1e-8));
  let cp = own.y / sn;
  let sp = own.z / sn;
  let up = sqrt(max(1.0 - dot(k.xy, k.xy), 0.02));
  let n = vec3f(0.0, -sp, cp) * k.x + vec3f(-sn, own.x * cp, own.x * sp) * k.y + own * up;
  return s.x.xyz * n.x + s.y.xyz * n.y + s.z.xyz * n.z;
}

// the blur's radius in pixels at depth w: nearer than the focus negative
fn blurAt(w: f32) -> f32 { return clamp(frame.misc.y * frame.size.z * (1.0 / frame.misc.z - 1.0 / w), -frame.misc.w, frame.misc.w); }
