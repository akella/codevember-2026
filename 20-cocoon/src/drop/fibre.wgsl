// every stretch between two control points is a ribbon turned to the eye, never drawn thinner than a
// pixel: a thinner fibre is drawn a pixel wide and that much fainter
struct Kind { first: u32, n: u32, points: u32, knots: u32, codeFirst: u32, own: u32, count: u32, lit: u32, map: u32, cull: u32, veil: u32, veils: u32 }
@group(1) @binding(0) var<uniform> kind: Kind;
@group(1) @binding(1) var<storage, read> points: array<vec4f>;
@group(1) @binding(2) var<storage, read> lit: array<vec2u>;

struct Out {
  @builtin(position) clip: vec4f,
  @location(0) light: vec3f,
  @location(1) @interpolate(linear) across: f32,       // pixels from the middle
  @location(2) @interpolate(linear) wide: f32,         // and how many it is wide
  @location(3) @interpolate(linear) blur: f32,
}

// how many ribbons between two control points; and how far the air moves it
@group(1) @binding(3) var<uniform> split: vec4u;


@vertex
fn vertex(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Out {
  let per = (kind.points - 1u) * split.x;
  let i = ii / per;
  let step = ii - i * per + (vi >> 1u);
  let j = min(step / split.x, kind.points - 2u);
  let t = f32(step - j * split.x) / f32(split.x);
  let side = f32(vi & 1u) * 2.0 - 1.0;
  let g = kind.first + i * kind.points + j;
  var o: Out;
  if (kind.cull > 0u) {
    // on the far side of its cocoon
    let c = shapes[body.id.x].centre.xyz;
    let m = points[kind.first + i * kind.points + kind.points / 2u].xyz;
    if (dot(normalize(m - c), normalize(body.eye.xyz - m)) < -0.34) {
      o.clip = vec4f(0.0, 0.0, -1.0, 1.0);
      return o;
    }
  }
  // a smooth curve through the control points, the one Cycles draws
  let b = points[g];
  let c = points[g + 1u];
  let a = points[g - select(0u, 1u, j > 0u)].xyz;
  if (b.w + c.w < 1e-7) {                              // not there now
    o.clip = vec4f(0.0, 0.0, -1.0, 1.0);
    return o;
  }
  let d = points[g + select(1u, 2u, j + 2u < kind.points)].xyz;
  let k1 = 0.5 * (c.xyz - a);
  let k2 = a - 2.5 * b.xyz + 2.0 * c.xyz - 0.5 * d;
  let k3 = 0.5 * (d - a) + 1.5 * (b.xyz - c.xyz);
  var p = b.xyz + t * (k1 + t * (k2 + t * k3));
  let w = k1 + t * (2.0 * k2 + t * 3.0 * k3);
  // the air moves what isn't tied down: nothing at a fibre's ends, most in its middle
  let s = (f32(j) + t) / f32(kind.points - 1u);
  let slack = bitcast<f32>(split.y) * sin(3.14159265359 * s);
  let air = frame.misc.x + vec3f(dot(p, vec3f(1.9, 1.1, -1.6)), dot(p, vec3f(-1.3, 1.7, 2.1)), dot(p, vec3f(1.2, -1.5, 1.8)));
  p += slack * (sin(air * vec3f(1.0) + frame.misc.x * vec3f(3.0, 4.0, 2.0)) * vec3f(1.0, 0.45, 1.0)
     + 0.35 * sin(air.zxy * 3.0 + frame.misc.x * vec3f(6.0, 4.0, 8.0) + f32(i) * 0.37));
  let clip = frame.viewProj * vec4f(place(p), 1.0);
  let along = frame.viewProj * vec4f(swing(w), 0.0);
  let way = (along.xy * clip.w - clip.xy * along.w) * frame.size.xy;
  let across = normalize(vec2f(-way.y, way.x) + vec2f(1e-12, 0.0));
  o.wide = 2.0 * mix(b.w, c.w, t) * frame.spin.w * frame.size.z / clip.w;
  o.blur = blurAt(clip.w);
  let half = max(o.wide, 1.0) * 0.5 + 0.5;
  o.across = side * half;
  o.clip = vec4f(clip.xy + across * side * half * 2.0 / frame.size.xy * clip.w, clip.zw);
  let q = kind.lit + i * kind.points + j;
  let l = lit[q];
  let m = lit[q + 1u];
  o.light = mix(vec3f(unpack2x16float(l.x), unpack2x16float(l.y).x), vec3f(unpack2x16float(m.x), unpack2x16float(m.y).x), t);
  return o;
}

struct Ink { @location(0) light: vec4f, @location(1) soft: vec4f }

@fragment
fn fragment(o: Out) -> Ink {
  let a = clamp(max(o.wide, 1.0) * 0.5 + 0.5 - abs(o.across), 0.0, 1.0) * min(o.wide, 1.0);
  return Ink(vec4f(o.light * a, a), vec4f(o.blur * a, a, 0.0, a));
}
