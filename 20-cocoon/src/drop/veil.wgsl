// how much more or less of each lamp's light comes to a few places along every fibre than at rest
struct Kind { first: u32, n: u32, points: u32, knots: u32, codeFirst: u32, own: u32, count: u32, lit: u32, map: u32, cull: u32, veil: u32, veils: u32 }
@group(1) @binding(0) var<uniform> kind: Kind;
@group(1) @binding(1) var<storage, read> points: array<vec4f>;
@group(1) @binding(2) var<storage, read_write> veils: array<vec2u>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= kind.n * kind.veils) { return; }
  let i = id.x / kind.veils;
  let k = id.x - i * kind.veils;
  let p = points[kind.first + i * kind.points + (k * (kind.points - 1u)) / (kind.veils - 1u)].xyz;
  let v = veil(p);
  veils[kind.veil + id.x] = vec2u(pack2x16float(v.xy), pack2x16float(vec2f(v.z, 0.0)));
}
