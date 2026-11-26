// How much silk of a line's web there is about it, in a box of cells: every stretch of every strand adds its length
// to the cell it is in. (What the webs' shadows are worked out from: field.wgsl, veil.wgsl.)
struct Splat { first: u32, count: u32, points: u32, column: u32, box: vec4f }
@group(0) @binding(0) var<uniform> s: Splat;
@group(0) @binding(1) var<storage, read> points: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> grid: array<atomic<u32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= s.count) { return; }
  if ((id.x + 1u) % s.points == 0u) { return; }
  let a = points[s.first + id.x];
  let b = points[s.first + id.x + 1u];
  let c = vec3i(floor(((a.xyz + b.xyz) * 0.5 - s.box.xyz) / CELL));
  if (any(c < vec3i(0)) || any(c >= vec3i(GX, GY, GZ))) { return; }
  let at = ((s.column * GZ + u32(c.z)) * GY + u32(c.y)) * GX + u32(c.x);
  atomicAdd(&grid[at], u32(min(length(b.xyz - a.xyz), 0.5) * 4096.0));
}
