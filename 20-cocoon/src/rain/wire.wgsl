// Debug: every strand as the line through its control points. A web's are coloured by what the physics says of them.
struct Kind { first: u32, n: u32, points: u32, knots: u32, codeFirst: u32, own: u32, count: u32, lit: u32, map: u32, cull: u32, veil: u32, veils: u32, full: u32, stride: u32, wide: f32, rest: u32 }
@group(1) @binding(0) var<uniform> kind: Kind;
@group(1) @binding(1) var<storage, read> points: array<vec4f>;
struct Wire { colour: vec4f, torn: vec4f, when: f32, strands: u32 }
@group(1) @binding(2) var<uniform> wire: Wire;
// when each strand of a web snaps
@group(1) @binding(3) var<storage, read> snaps: array<f32>;

struct Out { @builtin(position) clip: vec4f, @location(0) colour: vec4f }

@vertex
fn vertex(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Out {
  let per = kind.points - 1u;
  let i = ii / per;
  let j = min((ii - i * per + vi) * kind.stride, kind.full - 1u);
  var o: Out;
  o.clip = frame.viewProj * vec4f(place(points[kind.first + i * kind.full + j].xyz), 1.0);
  o.colour = wire.colour;
  if (wire.strands > 0u && wire.when >= snaps[i % wire.strands]) { o.colour = wire.torn; }
  return o;
}
@fragment
fn fragment(o: Out) -> @location(0) vec4f { return vec4f(o.colour.rgb * o.colour.a, o.colour.a); }
