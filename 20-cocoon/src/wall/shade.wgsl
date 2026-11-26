// the light at every control point of every fibre of a kind, seen from the eye

struct Kind { first: u32, n: u32, points: u32, knots: u32, codeFirst: u32, own: u32, count: u32, lit: u32, map: u32, cull: u32, veil: u32, veils: u32, full: u32, stride: u32, wide: f32, rest: u32 }
@group(1) @binding(0) var<uniform> kind: Kind;
// of every fibre only each `stride`th point, and the last
fn pointOf(j: u32) -> u32 { return min(j * kind.stride, kind.full - 1u); }
@group(1) @binding(1) var<storage, read> points: array<vec4f>;
@group(1) @binding(2) var<storage, read> codes: array<u32>;
@group(1) @binding(3) var<storage, read_write> lit: array<vec2u>;
// whose learnt numbers a strand takes
@group(1) @binding(4) var<storage, read> codeOf: array<u32>;
// the shadows, at a few places along each (veil.wgsl)
@group(1) @binding(5) var<storage, read> veils: array<vec2u>;
fn veilAt(i: u32, t: f32) -> vec3f {
  let x = t * f32(kind.veils - 1u);
  let j = min(u32(x), kind.veils - 2u);
  let a = veils[kind.veil + i * kind.veils + j];
  let b = veils[kind.veil + i * kind.veils + j + 1u];
  return mix(vec3f(unpack2x16float(a.x), unpack2x16float(a.y).x), vec3f(unpack2x16float(b.x), unpack2x16float(b.y).x), x - f32(j));
}
@group(1) @binding(6) var coarseTex: texture_2d_array<f32>;
@group(1) @binding(7) var fineTex: texture_2d_array<f32>;
@group(1) @binding(8) var around: sampler;
@group(1) @binding(9) var detailTex: texture_2d_array<f32>;

fn code(i: u32, j: u32, k: u32) -> vec4f { return unpack4x8unorm(codes[kind.codeFirst + (codeOf[kind.map + i] * kind.knots + j) * kind.own + k]); }

fn code2(i: u32, t: f32, k: u32) -> vec4f {
  let x = t * f32(kind.knots - 1u);
  let j = min(u32(x), kind.knots - 2u);
  return mix(code(i, j, k), code(i, j + 1u, k), x - f32(j)) * 2.0 - 1.0;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let at = id.x + id.y * 65535u * 64u;
  if (at >= kind.count) { return; }
  let i = at / kind.points;
  let j = at - i * kind.points;
  let row = kind.first + i * kind.full;
  let q = pointOf(j);
  let p = points[row + q].xyz;
  let eye = body.eye.xyz;
  let toEye = eye - p;
  let view = normalize(toEye);
  let t = f32(q) / f32(kind.full - 1u);
  let tangent = normalize(points[row + pointOf(min(j + 1u, kind.points - 1u))].xyz - points[row + pointOf(max(j, 1u) - 1u)].xyz);
  SHADE
  lit[kind.lit + at] = vec2u(pack2x16float(min(c.rg, vec2f(200.0))), pack2x16float(vec2f(min(c.b, 200.0), min(key, 200.0))));
}
