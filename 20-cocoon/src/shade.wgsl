// the light at every control point of every fibre of a kind, seen from the eye
struct Kind { first: u32, n: u32, points: u32, knots: u32, codeFirst: u32, own: u32, count: u32, perCocoon: u32 }
@group(1) @binding(0) var<uniform> kind: Kind;
@group(1) @binding(1) var<storage, read> points: array<vec4f>;
@group(1) @binding(2) var<storage, read> codes: array<u32>;
@group(1) @binding(3) var<storage, read_write> lit: array<vec2u>;
@group(1) @binding(4) var coarseTex: texture_2d_array<f32>;
@group(1) @binding(5) var fineTex: texture_2d_array<f32>;
@group(1) @binding(6) var around: sampler;
@group(1) @binding(7) var detailTex: texture_2d_array<f32>;

fn code(i: u32, j: u32, k: u32) -> vec4f { return unpack4x8unorm(codes[kind.codeFirst + (i * kind.knots + j) * kind.own + k]); }

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
  let g = kind.first + at;
  let p = points[g].xyz;
  let eye = turn(frame.eye.xyz, -angleAt(p.y));
  let toEye = eye - p;
  let view = normalize(toEye);
  let t = f32(j) / f32(kind.points - 1u);
  let tangent = normalize(points[g + select(0u, 1u, j + 1u < kind.points)].xyz - points[g - select(0u, 1u, j > 0u)].xyz);
  SHADE
  lit[g] = vec2u(pack2x16float(min(c.rg, vec2f(200.0))), pack2x16float(vec2f(min(c.b, 200.0), 0.0)));
}
