// What falls on each place of the cocoon, over a grid: how much of each lamp's light comes by the pupa inside; and what
// the light inside comes to there, as a share of what it was learnt with (a ball of light in the middle).
struct Field { w: u32, h: u32, layer: u32, inner: u32 }
@group(1) @binding(0) var fieldOut: texture_storage_2d_array<rgba16float, write>;
@group(1) @binding(1) var<uniform> field: Field;

// the pupa: blunt head up, eyes, wing cases that end in a step, ringed and tapering below; it bends its rings
fn pupa(p: vec3f) -> f32 {
  let size = body.pupa.w;
  let q = (p - body.pupa.xyz) / size;
  let side = vec3f(0.0, body.spine.yz);
  let other = cross(vec3f(1.0, 0.0, 0.0), side);
  let tail = clamp(-q.x / 0.5, 0.0, 1.2);
  let a = dot(q, side) - body.spine.x * tail * tail;
  let o = dot(q, other);
  let x = q.x / 0.56;
  var r = 0.27 * pow(max(1.0 - x * x, 0.0), 0.42) * mix(1.0, 0.60, smoothstep(0.05, -1.0, x));
  let neck = (x - 0.62) / 0.09;
  r *= 1.0 - 0.13 * exp(-neck * neck);
  r *= 1.0 + 0.09 * smoothstep(-0.15, -0.10, x);
  r *= 1.0 + 0.075 * sin(q.x * 40.0) * smoothstep(-0.10, -0.2, x);
  var d = length(vec2f(a, o)) - r;
  let cap = max(abs(x) - 1.0, 0.0) * 0.56;
  d = select(d * 0.7, length(vec2f(max(d, 0.0), cap)) * 0.7, cap > 0.0);
  // eyes; and the tail's hook
  let e = length(vec3f(q.x - 0.41, a - 0.06, abs(o) - 0.185)) - 0.055;
  let t = length(vec3f(q.x + 0.585, a - body.spine.x * 1.1, o)) - 0.022;
  return size * min(d, min(e, t) * 0.9);
}
// how clear the way is from p along d for `far`, softer by `open` the farther from p it is stopped
fn clearWay(p: vec3f, d: vec3f, far: f32, near: f32, open: f32) -> f32 {
  var least = 1.0;
  var s = 0.012;
  for (var k = 0; k < 26; k++) {
    let h = pupa(p + d * s);
    least = min(least, 0.5 + 0.5 * h / (near + open * s));
    s += max(h, 0.016);
    if (s > far || least <= 0.0) { break; }
  }
  return smoothstep(0.0, 1.0, clamp(least, 0.0, 1.0));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= field.w || id.y >= field.h) { return; }
  let phi = (f32(id.x) + 0.5) / f32(field.w) * 6.28318530718;
  let th = (f32(id.y) + 0.5) / f32(field.h) * 3.14159265359;
  let own = vec3f(cos(th), sin(th) * cos(phi), sin(th) * sin(phi));
  let s = shapes[0];
  let p = own * radial(s, own);
  let view = normalize(body.eye.xyz - p);
  if (dot(own, view) < -0.8) { return; }
  let n = normalize(p / vec3f(s.abp.x * s.abp.x, s.abp.y * s.abp.y, s.abp.y * s.abp.y));
  // its body is in the way of what comes from behind
  var by = vec3f(1.0);
  for (var k = 0u; k < 3u; k++) {
    let l = lampDir(k);
    let through = smoothstep(0.25, -0.15, dot(n, l));
    if (through > 0.0) { by[k] = 1.0 - 0.8 * through * (1.0 - clearWay(p, l, 1.5, 0.03, 0.22)); }
  }
  let to = body.lamp.xyz - p;
  let far = length(to);
  let d = to / far;
  let falls = max(dot(-n, d), 0.0) / (far * far + 0.03);
  var inner = body.lamp.w / (far * far + 0.5) + 0.42 * falls * clearWay(p, d, far, 0.03, 0.17);
  let r0 = length(p);
  inner /= max(dot(n, p / r0), 0.3) / (r0 * r0) * 0.36;
  // the silk isn't quite closed: what is right behind it shows
  inner *= 1.0 - body.spine.w * (1.0 - clearWay(p, -view, 1.3, 0.010, 0.13));
  textureStore(fieldOut, id.xy, field.layer, vec4f(by, inner));
}
