struct Post { size: vec4f, tone: vec4f, look: vec4f, tint: vec4f }
@group(0) @binding(0) var<uniform> post: Post;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var glow: texture_2d<f32>;

struct Out { @builtin(position) clip: vec4f, @location(0) uv: vec2f }
@vertex
fn screen(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return Out(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}

// half the size, by a wide tent so that a hair a pixel wide doesn't flicker
@fragment
fn down(o: Out) -> @location(0) vec4f {
  let t = 1.0 / vec2f(textureDimensions(src));
  var c = textureSampleLevel(src, smp, o.uv, 0.0).rgb * 4.0;
  for (var i = 0; i < 4; i++) {
    let s = vec2f(f32(i & 1) * 2.0 - 1.0, f32(i >> 1) * 2.0 - 1.0);
    c += textureSampleLevel(src, smp, o.uv + s * t * 1.0, 0.0).rgb * 2.0;
    c += textureSampleLevel(src, smp, o.uv + s * t * 2.0, 0.0).rgb;
  }
  return vec4f(c / 16.0, 1.0);
}

// back up, each size added to the next
@fragment
fn up(o: Out) -> @location(0) vec4f {
  let t = 1.0 / vec2f(textureDimensions(src));
  var c = vec3f(0.0);
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let w = f32((2 - abs(x)) * (2 - abs(y))) / 16.0;
    c += w * textureSampleLevel(src, smp, o.uv + vec2f(f32(x), f32(y)) * t, 0.0).rgb;
  } }
  return vec4f(c * post.look.y, 1.0);
}

fn hash(p: vec2u) -> f32 {
  var h = (p.x * 0x8da6b343u) ^ (p.y * 0xd8163841u);
  h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u;
  return f32(h) / 4294967296.0;
}

// highlights roll off as film does, by a curve over each channel with some of the hue kept
fn film(x: vec3f) -> vec3f {
  let y = max(x, vec3f(0.0));
  return (y * (y * 2.2 + 0.06)) / (y * (y * 2.0 + 0.80) + 0.16);
}

@fragment
fn final_(o: Out) -> @location(0) vec4f {
  var c = textureSampleLevel(src, smp, o.uv, 0.0).rgb;
  let g = textureSampleLevel(glow, smp, o.uv, 0.0).rgb;
  // what blending strands out of order averages away: contrast against the few pixels round it
  let px = post.size.z / post.size.xy;
  var near = dot(c, vec3f(1.0));
  let mid = near;
  for (var i = 0; i < 12; i++) {
    let a = f32(i) * 2.39996323;
    near += dot(textureSampleLevel(src, smp, o.uv + vec2f(cos(a), sin(a)) * px * sqrt((f32(i) + 1.0) / 12.0), 0.0).rgb, vec3f(1.0));
  }
  near /= 13.0;
  c *= 1.0 + post.size.w * clamp((mid - near) / (mid + near + 1e-3), -0.5, 0.5);
  c = mix(c, g, post.look.x);
  c *= post.tone.x;
  let l = dot(c, vec3f(0.25, 0.65, 0.10));
  let per = film(c);
  let hue = c * (film(vec3f(l)).x / max(l, 1e-5));
  c = mix(per, hue, 0.25);
  c = pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(post.tone.y / 2.2));
  c += (hash(vec2u(o.clip.xy)) - 0.5) / 255.0;
  return vec4f(c, 1.0);
}
