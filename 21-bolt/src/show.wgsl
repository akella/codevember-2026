// The traced picture put together: the floor's mirror picture blurred as rough stone would, then glow, and the
// whole brought into the range a screen has.

struct Shown {
  size: vec4f, // of the screen, then exposure and grain
  more: vec4f, // frame, vignette, how much glow, how far it spreads
  eye: vec4f, // radians a pixel, how much the floor blurs, colour, how high the eye is
};
@group(0) @binding(0) var<uniform> S: Shown;
@group(0) @binding(1) var pic: texture_2d<f32>;
@group(0) @binding(2) var soft: sampler;
@group(0) @binding(3) var mirrored: texture_2d<f32>;
@group(0) @binding(4) var aux: texture_2d<f32>;

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

// half the size, (colour and cover together, so what is not floor does not darken what is)
@fragment
fn halve(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(pic));
  return textureSampleLevel(pic, soft, at.xy * 2.0 * texel, 0.0);
}

@fragment
fn join(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let p = vec2i(at.xy);
  var col = textureLoad(pic, p, 0).rgb;
  var a = textureLoad(aux, p, 0);
  // how far off what it mirrors is, taken over a little patch, or neighbours blur by different amounts and show it
  // (the mirror picture is one pixel in four)
  if (a.y > 0.0) {
    var far = vec2f(0.0);
    for (var k = 0; k < 25; k++) {
      let q = (p + (vec2i(k % 5, k / 5) - 2) * vec2i(6, 8)) & vec2i(-2);
      let b = textureLoad(aux, clamp(q, vec2i(0), vec2i(textureDimensions(aux)) - 2), 0);
      if (b.y > 0.0 && b.x > 0.0) { far += vec2f(b.x, 1.0); }
    }
    a.x = far.x / max(far.y, 1.0);
  }
  if (a.y > 0.0) {
    let size = vec2f(textureDimensions(pic));
    let tall = 2.0 * a.z * S.eye.y * a.x / (a.x + a.w) / S.eye.x;
    let grazing = clamp(S.eye.w / a.w, 0.05, 1.0); // how steeply the floor is seen: the eye's height over the distance
    let wide = tall * grazing;
    let n = 24;
    let gap = tall * 4.0 / f32(n);
    let level = max(log2(max(wide, gap)), 1.0);
    var sum = vec4f(0.0);
    for (var i = 0; i < n; i++) {
      let x = (f32(i) + 0.5) / f32(n) * 2.0 - 1.0;
      // (long in the tail, as polished stone is)
      let w = 1.0 / pow(1.0 + 9.0 * x * x, 1.6);
      let uv = (at.xy + vec2f(0.0, x * tall * 2.0)) / size;
      if (uv.y > 1.0 || uv.y < 0.0) { continue; }
      sum += w * textureSampleLevel(mirrored, soft, uv, level);
    }
    col += sum.rgb / max(sum.a, 1e-4) * a.y;
  }
  return vec4f(col, 1.0);
}

fn tame(c: vec3f) -> vec3f {
  let b = bitcast<vec3u>(c) & vec3u(0x7f800000u);
  return select(max(c, vec3f(0.0)), vec3f(0.0), b == vec3u(0x7f800000u));
}
@fragment
fn down(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(pic));
  let uv = at.xy * 2.0 * texel;
  var sum = tame(textureSampleLevel(pic, soft, uv, 0.0).rgb) * 4.0;
  sum += tame(textureSampleLevel(pic, soft, uv + vec2f(-1.0, -1.0) * texel, 0.0).rgb);
  sum += tame(textureSampleLevel(pic, soft, uv + vec2f(1.0, -1.0) * texel, 0.0).rgb);
  sum += tame(textureSampleLevel(pic, soft, uv + vec2f(-1.0, 1.0) * texel, 0.0).rgb);
  sum += tame(textureSampleLevel(pic, soft, uv + vec2f(1.0, 1.0) * texel, 0.0).rgb);
  return vec4f(sum / 8.0, 1.0);
}
@fragment
fn up(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(pic));
  let uv = at.xy * 0.5 * texel;
  var sum = vec3f(0.0);
  for (var k = 0; k < 4; k++) {
    let o = vec2f(f32(k & 1), f32(k >> 1)) * 2.0 - 1.0;
    sum += textureSampleLevel(pic, soft, uv + o * texel, 0.0).rgb * 2.0;
    sum += textureSampleLevel(pic, soft, uv + vec2f(o.x * f32(k >> 1), o.y * f32(1 - (k >> 1))) * 2.0 * texel, 0.0).rgb;
  }
  return vec4f(sum / 12.0 * S.more.w, 1.0);
}

// a shoulder that lets a hue go to white as it gets bright
fn curve(x: vec3f) -> vec3f {
  let a = x * (x * 2.51 + 0.03);
  let b = x * (x * 2.43 + 0.59) + 0.14;
  return clamp(a / b, vec3f(0.0), vec3f(1.0));
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = at.xy / S.size.xy;
  var col = tame(textureSampleLevel(pic, soft, uv, 0.0).rgb);
  col = mix(col, textureSampleLevel(mirrored, soft, uv, 0.0).rgb, S.more.z);
  col *= S.size.z;
  let away = uv - 0.5;
  col *= 1.0 - S.more.y * dot(away, away) * 1.6;
  // bright amber runs to yellow, then white
  let m = max(col.r, max(col.g, col.b));
  col = mix(col, vec3f(m), 0.12 * smoothstep(0.8, 6.0, m));
  col = curve(col);
  let grey = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  col = mix(vec3f(grey), col, S.eye.z);
  col = pow(max(col, vec3f(0.0)), vec3f(1.0 / 2.2));
  let n = fract(52.9829189 * fract(dot(at.xy + S.more.x * vec2f(5.3, 9.1), vec2f(0.06711056, 0.00583715))));
  col += (n - 0.5) * S.size.w;
  return vec4f(col, 1.0);
}
