@group(1) @binding(0) var<storage, read> relief: array<u32>;
@group(1) @binding(1) var coarseTex: texture_2d_array<f32>;
@group(1) @binding(2) var fineTex: texture_2d_array<f32>;
@group(1) @binding(3) var around: sampler;
@group(1) @binding(5) var detailTex: texture_2d_array<f32>;
struct Grid { u: u32, v: u32, lo: f32, hi: f32 }
@group(1) @binding(4) var<uniform> grid: Grid;

struct Out {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(linear) own: vec3f,        // where it is, in the cocoon's own frame and as it hangs
  @location(1) body: vec3f,
  @location(2) @interpolate(flat) n: u32,
}

@vertex
fn vertex(@builtin(vertex_index) vi: u32, @builtin(instance_index) n: u32) -> Out {
  let iu = vi % grid.u;
  let iv = vi / grid.u;
  let phi = f32(iu) / f32(grid.u) * 6.28318530718;
  let th = f32(iv) / f32(grid.v) * 3.14159265359;
  let own = vec3f(cos(th), sin(th) * cos(phi), sin(th) * sin(phi));
  let s = shapes[n];
  let at = n * grid.u * (grid.v + 1u) + vi;
  let h = mix(grid.lo, grid.hi, f32((relief[at / 4u] >> ((at % 4u) * 8u)) & 255u) / 255.0);
  let d = s.x.xyz * own.x + s.y.xyz * own.y + s.z.xyz * own.z;
  var o: Out;
  o.body = s.centre.xyz + d * (radial(s, own) + h);
  o.own = own;
  o.n = n;
  o.clip = frame.viewProj * vec4f(turn(o.body, angleAt(o.body.y)), 1.0);
  return o;
}

struct Ink { @location(0) light: vec4f, @location(1) soft: vec4f }

@fragment
fn fragment(o: Out) -> Ink {
  let s = shapes[o.n];
  let d = normalize(o.body - s.centre.xyz);
  let own = vec3f(dot(s.x.xyz, d), dot(s.y.xyz, d), dot(s.z.xyz, d));
  let uv = vec2f(atan2(own.z, own.y) / 6.28318530718, acos(clamp(own.x, -1.0, 1.0)) / 3.14159265359);
  // atan2 jumps once round the cocoon: take the derivatives of the direction instead
  let dx = dpdx(own);
  let dy = dpdy(own);
  let rr = max(own.y * own.y + own.z * own.z, 1e-5);
  let gx = vec2f((own.y * dx.z - own.z * dx.y) / rr / 6.28318530718, -dx.x / sqrt(rr) / 3.14159265359);
  let gy = vec2f((own.y * dy.z - own.z * dy.y) / rr / 6.28318530718, -dy.x / sqrt(rr) / 3.14159265359);
  let view = normalize(turn(frame.eye.xyz, -angleAt(o.body.y)) - o.body);
  let k = textureSampleGrad(detailTex, around, uv, o.n, gx, gy) * 2.0 - 1.0;
  let normal = crinkled(s, own, k);
  var x: array<vec4f, 10>;
  for (var l = 0u; l < 4u; l++) { x[l] = textureSampleLevel(coarseTex, around, uv, o.n * 4u + l, 0.0) * 2.0 - 1.0; }
  for (var l = 0u; l < 2u; l++) { x[4u + l] = textureSampleGrad(fineTex, around, uv, o.n * 2u + l, gx, gy) * 2.0 - 1.0; }
  x[6] = vec4f(d, view.x);
  x[7] = vec4f(view.yz, normal.xy);
  x[8] = vec4f(normal.z, k.zw, dot(d, view));
  x[9] = vec4f(dot(normal, view), 0.0, 0.0, 0.0);
  return Ink(vec4f(run_shell(&x), 1.0), vec4f(blurAt(1.0 / o.clip.w), 1.0, 0.0, 1.0));
}
