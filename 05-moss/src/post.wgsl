// A macro lens: everything is drawn sharp, then blurred by how far it lies from the focus.

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var clampLinear: sampler;

struct Screen {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> Screen {
  let c = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: Screen;
  o.clip = vec4f(c * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(c.x, 1.0 - c.y);
  return o;
}

/** the alpha channel holds distance from the plane of focus: half floats are finest near zero, where sharpness gets decided */
fn blurOf(offset: f32, widest: f32) -> f32 {
  let focus = frame.skyTop.w;
  let aperture = frame.skyLow.w;
  return clamp(abs(offset) / (offset + focus) * aperture * frame.size.y, 0.0, widest);
}

// Troy Sobotka's AgX, fitted by Benjamin Wrensch
fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

fn agx(c: vec3f) -> vec3f {
  let inMat = mat3x3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                      0.0784335999999992, 0.878468636469772, 0.0784336,
                      0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  let outMat = mat3x3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                       -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                       -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  var v = inMat * max(c, vec3f(1e-10));
  v = clamp(log2(v), vec3f(-12.47393), vec3f(4.026069));
  v = (v + 12.47393) / 16.5;
  v = agxContrast(v);
  // punch: a little more contrast and colour than the base look
  let luma = dot(v, vec3f(0.2126, 0.7152, 0.0722));
  v = pow(v, vec3f(1.22));
  v = luma + 1.1 * (v - luma);
  v = outMat * v;
  return clamp(v, vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(i: Screen) -> @location(0) vec4f {
  let texel = frame.size.zw;
  let center = textureSampleLevel(scene, clampLinear, i.uv, 0.0);
  let widest = frame.size.y * 0.028;
  let radius0 = blurOf(center.a, widest);

  var sum = center.rgb;
  var seen = 1.0;
  var radius = 0.75;
  var angle = fract(sin(dot(i.clip.xy, vec2f(12.9898, 78.233))) * 43758.5453) * 6.28;
  // a spiral that widens as it goes, in the spirit of Dennis Gustafsson's one pass bokeh
  // a sharp pixel only looks a little way around: it misses a very blurred leaf drifting across it
  // from far off, which nobody will notice, and it is most of the screen and all of the backdrop
  let look = min(widest, max(radius0 * 1.6, frame.size.y * 0.004));
  for (var k = 0; k < 80; k++) {
    if (radius > look) { break; }
    angle += 2.39996;
    let at = i.uv + vec2f(cos(angle), sin(angle)) * radius * texel;
    let s = textureSampleLevel(scene, clampLinear, at, 0.0);
    var size = blurOf(s.a, widest);
    // what is behind the pixel can't bleed over it
    if (s.a > center.a) { size = min(size, radius0 * 2.0); }
    let m = smoothstep(radius - 0.5, radius + 0.5, size);
    sum += mix(sum / seen, s.rgb, m);
    seen += 1.0;
    radius += 1.1 * 1.0 / radius * max(1.0, widest / 18.0) + 0.1;
  }
  var color = sum / seen;

  let c = i.uv - 0.5;
  let vignette = 1.0 - dot(c, c) * 0.9;
  color *= vignette * vignette;

  var out = agx(color * 1.55);
  // a trace of grain, so the darks aren't plastic
  let grain = fract(sin(dot(i.clip.xy + frame.eye.w, vec2f(91.17, 47.31))) * 24634.63) - 0.5;
  out += grain * 0.012;
  return vec4f(out, 1.0);
}
