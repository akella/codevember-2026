// The shells' light, worked out once a frame for every place of a grid over each and not for every pixel of the
// screen: most of them lies under silk. Finer when it is near.
@group(1) @binding(0) var coarseTex: texture_2d_array<f32>;
@group(1) @binding(1) var fineTex: texture_2d_array<f32>;
@group(1) @binding(2) var around: sampler;
@group(1) @binding(3) var detailTex: texture_2d_array<f32>;
@group(1) @binding(4) var lightTex: texture_storage_2d_array<rgba16float, write>;
struct Glaze { w: u32, h: u32, layer: u32, lod: f32 }
@group(1) @binding(5) var<uniform> glaze: Glaze;

// the shadows change slowly: at the corners of every eight by eight, and between
var<workgroup> corner: array<vec3f, 4>;
fn along(uv: vec2f) -> vec3f {
  let phi = uv.x * 6.28318530718;
  let th = uv.y * 3.14159265359;
  return vec3f(cos(th), sin(th) * cos(phi), sin(th) * sin(phi));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(workgroup_id) tile: vec3u, @builtin(local_invocation_id) l: vec3u, @builtin(local_invocation_index) k0: u32) {
  if (k0 < 4u) {
    let at = (vec2f(tile.xy) + vec2f(f32(k0 & 1u), f32(k0 >> 1u))) * 8.0 / vec2f(f32(glaze.w), f32(glaze.h));
    let o = along(at);
    corner[k0] = veil(o * radial(shapes[body.id.x], o));
  }
  workgroupBarrier();
  // one column more than there are: the first again, to blend round to
  if (id.x > glaze.w || id.y >= glaze.h) { return; }
  let uv = vec2f(f32(id.x % glaze.w) / f32(glaze.w), (f32(id.y) + 0.5) / f32(glaze.h));
  let own = along(uv);
  let n = body.id.x;
  let s = shapes[n];
  let d = own;
  let p = d * radial(s, own);
  let view = normalize(body.eye.xyz - p);
  if (dot(d, view) < -0.42) { return; }
  let f = vec2f(l.xy) / 8.0;
  let shade = mix(mix(corner[0], corner[1], f.x), mix(corner[2], corner[3], f.x), f.y);
  let k = textureSampleLevel(detailTex, around, uv, n, glaze.lod) * 2.0 - 1.0;
  let normal = crinkled(s, own, k);
  var x: array<vec4f, 10>;
  for (var l = 0u; l < 4u; l++) { x[l] = textureSampleLevel(coarseTex, around, uv, n * 4u + l, 0.0) * 2.0 - 1.0; }
  for (var l = 0u; l < 2u; l++) { x[4u + l] = textureSampleLevel(fineTex, around, uv, n * 2u + l, 0.0) * 2.0 - 1.0; }
  x[6] = vec4f(d, view.x);
  x[7] = vec4f(view.yz, normal.xy);
  x[8] = vec4f(normal.z, k.zw, dot(d, view));
  x[9] = vec4f(dot(normal, view), 0.0, 0.0, 0.0);
  textureStore(lightTex, id.xy, glaze.layer, vec4f(min(shaded(run_shell(&x), shade), vec3f(200.0)), 1.0));
}
