// What falls on each place of a cocoon, over a grid: how much of each lamp's light its web lets by; and (lantern.html)
// what the light inside comes to there, round the pupa.
struct Field { w: u32, h: u32, layer: u32, inner: u32 }
@group(1) @binding(1) var fieldOut: texture_storage_2d_array<rgba16float, write>;
@group(1) @binding(2) var<uniform> field: Field;

// the pupa: blunt head up, wing cases that end in a step, ringed and tapering below; it bends its rings
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
  let neck = (x - 0.62) / 0.10;
  r *= 1.0 - 0.10 * exp(-neck * neck);
  r *= 1.0 + 0.07 * smoothstep(-0.16, -0.10, x);
  r *= 1.0 + 0.055 * sin(q.x * 40.0) * smoothstep(-0.10, -0.2, x);
  let d = length(vec2f(a, o)) - r;
  let cap = max(abs(x) - 1.0, 0.0) * 0.56;
  return size * select(d * 0.7, length(vec2f(max(d, 0.0), cap)) * 0.7, cap > 0.0);
}
// how clear the way is from p along d for `far`, softer by `open` the farther from p it is stopped
fn clearWay(p: vec3f, d: vec3f, far: f32, near: f32, open: f32) -> f32 {
  var least = 1.0;
  var s = 0.015;
  for (var k = 0; k < 18; k++) {
    let h = pupa(p + d * s);
    least = min(least, 0.5 + 0.5 * h / (near + open * s));
    s += max(h, 0.028);
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
  let s = shapes[body.id.x];
  let p = own * radial(s, own);
  let view = normalize(body.eye.xyz - p);
  if (dot(own, view) < -0.75) { return; }
  let n = normalize(p / vec3f(s.abp.x * s.abp.x, s.abp.y * s.abp.y, s.abp.y * s.abp.y));
  let here = place(p) + swing(n) * 0.04;
  let web = webShade(here);
  var inner = 1.0;
  if (field.inner > 0u) {
    let to = body.lamp.xyz - p;
    let far = length(to);
    let d = to / far;
    let falls = max(dot(-n, d), 0.0) / (far * far + 0.03);
    // (what has gone round inside is brighter near the lamp too)
    inner = body.lamp.w * 1.1 / (far * far + 0.5) + 0.75 * falls * clearWay(p, d, far, 0.015, 0.11);
    // the silk isn't quite closed: what is right behind it shows
    inner *= 1.0 - body.spine.w * (1.0 - clearWay(p, -view, 1.3, 0.012, 0.17));
  }
  textureStore(fieldOut, id.xy, field.layer, vec4f(web, inner));
}
