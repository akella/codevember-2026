// The traced picture put together: the floor's mirror picture blurred as rough stone would, then glow, and the
// whole brought into the range a screen has.

struct Shown {
  size: vec4f, // of the screen, then exposure and grain
  more: vec4f, // frame, vignette, how much glow, how far it spreads
  eye: vec4f, // radians a pixel, how much the floor blurs, colour, how high the eye is
  grade: vec4f, // 1: AgX (0: the old curve); how punchy; how much the dark goes blue and the light warm; contrast
  lens: vec4f, // a red fringe to the glow (halation); a streak across the brightest; colour fringes to the edges; how bright for a streak
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
// AgX (Sobotka; the polynomial fit of it by Wrensch): bright colours go to white as film does, not to a harsher hue
fn agxCurve(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn agx(c: vec3f) -> vec3f {
  let into = mat3x3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  let out = mat3x3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  let lo = -12.47393;
  let hi = 4.026069;
  var v = clamp(log2(max(into * c, vec3f(1e-10))), vec3f(lo), vec3f(hi));
  v = agxCurve((v - lo) / (hi - lo));
  // (its "punchy" look, by how much)
  let punchy = pow(max(v, vec3f(0.0)), vec3f(1.35));
  let grey = dot(punchy, vec3f(0.2126, 0.7152, 0.0722));
  v = mix(v, mix(vec3f(grey), punchy, 1.4), S.grade.y);
  return max(out * v, vec3f(0.0)); // (as shown: no gamma after)
}
fn curve(x: vec3f) -> vec3f {
  let a = x * (x * 2.51 + 0.03);
  let b = x * (x * 2.43 + 0.59) + 0.14;
  return clamp(a / b, vec3f(0.0), vec3f(1.0));
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = at.xy / S.size.xy;
  var col = tame(textureSampleLevel(pic, soft, uv, 0.0).rgb);
  if (S.lens.z > 0.0) {
    // (red and blue a little apart toward the edges, as a lens does)
    let off = (uv - 0.5) * S.lens.z * 0.006;
    col = vec3f(tame(textureSampleLevel(pic, soft, uv + off, 0.0).rgb).r, col.g, tame(textureSampleLevel(pic, soft, uv - off, 0.0).rgb).b);
  }
  var glow = textureSampleLevel(mirrored, soft, uv, 0.0).rgb;
  // halation: what glows spreads red in the film
  glow *= mix(vec3f(1.0), vec3f(1.3, 0.78, 0.55), S.lens.x);
  col = mix(col, glow, S.more.z);
  if (S.lens.y > 0.0) {
    // a streak across the brightest lights, as an anamorphic lens draws them
    // (from a much softer copy of the glow, close taps, and only what is brighter than streakFrom)
    var streak = vec3f(0.0);
    for (var i = -10; i <= 10; i++) {
      let a = textureSampleLevel(aux, soft, uv + vec2f(f32(i) * 0.009, 0.0), 0.0).rgb;
      let l = max(a.r, max(a.g, a.b));
      streak += exp(-abs(f32(i)) * 0.22) * a * max(l - S.lens.w, 0.0) / max(l, 1e-4);
    }
    col += streak * S.lens.y * 0.05;
  }
  col *= S.size.z;
  let away = uv - 0.5;
  col *= 1.0 - S.more.y * dot(away, away) * 1.6;
  // bright amber runs to yellow, then white
  let m = max(col.r, max(col.g, col.b));
  col = mix(col, vec3f(m), 0.12 * smoothstep(0.8, 6.0, m));
  if (S.grade.x > 0.5) {
    col = agx(col);
  } else {
    col = pow(max(curve(col), vec3f(0.0)), vec3f(1.0 / 2.2));
  }
  let grey = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  col = mix(vec3f(grey), col, S.eye.z);
  // the grade: the dark a little blue, the light a little warm; and a little more contrast about the middle
  let l = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  col *= mix(vec3f(1.0), mix(vec3f(0.9, 0.98, 1.12), vec3f(1.07, 1.0, 0.9), smoothstep(0.04, 0.5, l)), S.grade.z);
  col = mix(col, col * col * (3.0 - 2.0 * col), S.grade.w);
  let n = fract(52.9829189 * fract(dot(at.xy + S.more.x * vec2f(5.3, 9.1), vec2f(0.06711056, 0.00583715))));
  col += (n - 0.5) * S.size.w;
  return vec4f(col, 1.0);
}
