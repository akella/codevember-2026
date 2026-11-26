@group(1) @binding(0) var<storage, read> relief: array<u32>;
struct Grid { u: u32, v: u32, lo: f32, hi: f32 }
@group(1) @binding(1) var<uniform> grid: Grid;
@group(1) @binding(2) var lightTex: texture_2d_array<f32>;
@group(1) @binding(3) var smp: sampler;
struct Glaze { w: u32, h: u32, layer: u32, lod: f32 }
@group(1) @binding(4) var<uniform> glaze: Glaze;

struct Out {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(linear) own: vec3f,        // where it is, in the cocoon's own frame and as it hangs
  @location(1) body: vec3f,
  @location(2) @interpolate(flat) n: u32,
  @location(3) @interpolate(flat) k: f32,
}

@vertex
fn vertex(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Out {
  let n = body.id.x;
  let copy = copies[body.id.z + ii];
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
  o.k = copy.w;
  o.clip = frame.viewProj * vec4f(place(o.body) + copy.xyz, 1.0);
  return o;
}

struct Ink { @location(0) light: vec4f, @location(1) soft: vec4f }

@fragment
fn fragment(o: Out) -> Ink {
  let own = normalize(o.body);
  let u = fract(atan2(own.z, own.y) / 6.28318530718);
  let v = acos(clamp(own.x, -1.0, 1.0)) / 3.14159265359;
  let size = vec2f(textureDimensions(lightTex));
  let at = vec2f(u * f32(glaze.w) + 0.5, clamp(v * f32(glaze.h), 0.5, f32(glaze.h) - 0.5)) / size;
  let a = textureSampleLevel(lightTex, smp, at, glaze.layer, 0.0);
  let lit = a.rgb + a.a * o.k * shadow.colours[0].rgb / max(dot(shadow.colours[0].rgb, vec3f(0.3, 0.6, 0.1)), 1e-4);
  return Ink(vec4f(lit * dimmed(o.clip.w), 1.0), vec4f(abs(blurAt(1.0 / o.clip.w)), 1.0, sign(blurAt(1.0 / o.clip.w)), 1.0));
}

