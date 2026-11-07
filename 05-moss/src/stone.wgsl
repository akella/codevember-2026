// The form, the ground it stands on, and what lies behind them.

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var volume: texture_3d<f32>;
@group(0) @binding(2) var field: texture_3d<f32>;
@group(0) @binding(3) var smooth3: sampler;

fn stone(p: vec3f) -> vec4f {
  return textureSampleLevel(volume, smooth3, toVolume(p), 0.0);
}

fn sunReach(p: vec3f, sun: vec3f) -> f32 {
  // ground far from the form starts its walk at the box, not at itself
  let start = max(enterBox(p, sun), 0.0);
  var t = start + 0.02;
  var lit = 1.0;
  for (var i = 0; i < 26; i++) {
    let q = p + sun * t;
    if (any(abs(q) > vec3f(DOM))) { break; }
    // the moss stands proud of the stone and shades as if it were solid
    let d = stone(q).r - 0.05;
    lit = min(lit, 5.0 * d / (t - start + 0.02) + 0.5);
    t += clamp(d, 0.015, 0.25);
  }
  return smoothstep(0.0, 1.0, clamp(lit, 0.0, 1.0));
}

struct Solid {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
};

@vertex
fn solidVs(@location(0) p: vec3f, @location(1) n: vec3f) -> Solid {
  var o: Solid;
  o.clip = frame.viewProj * vec4f(p, 1.0);
  o.world = p;
  o.normal = n;
  return o;
}

fn bump(p: vec3f, n: vec3f, scale: f32, amount: f32) -> vec3f {
  let e = 0.5 / scale;
  let c = fbm(p * scale, 4);
  let g = vec3f(fbm((p + vec3f(e, 0, 0)) * scale, 4), fbm((p + vec3f(0, e, 0)) * scale, 4), fbm((p + vec3f(0, 0, e)) * scale, 4)) - c;
  let tangent = g - n * dot(g, n);
  return normalize(n - tangent * amount / e);
}

@fragment
fn solidFs(i: Solid) -> @location(0) vec4f {
  let p = i.world;
  let view = normalize(frame.eye.xyz - p);
  // the finest grain only exists once it is big enough to see: below a pixel it is just noise
  let tooth = 1.0 - smoothstep(0.0012, 0.0045, length(fwidth(p)));
  let n = bump(p, bump(p, normalize(i.normal), 46.0, 0.02), 170.0, 0.012 * tooth);
  let v = stone(p + normalize(i.normal) * 0.02);
  let f = textureSampleLevel(field, smooth3, toVolume(p + normalize(i.normal) * 0.015), 0.0);

  let grain = fbm(p * 90.0, 3);
  // flecks of a harder mineral, and the fine tooth of the surface
  let fleck = smoothstep(0.62, 0.72, noise(p * 210.0));
  let blotch = fbm(p * 3.7 + 5.0, 4);
  var albedo = mix(vec3f(0.37, 0.34, 0.3), vec3f(0.54, 0.5, 0.43), blotch);
  albedo *= 1.0 + (grain - 0.5) * 0.36 * mix(0.3, 1.0, tooth);
  albedo = mix(albedo, albedo * 1.5, fleck * 0.5 * tooth);
  // water tracks down the face
  let streak = fbm(p * vec3f(14.0, 1.6, 14.0), 3);
  albedo *= 1.0 - 0.32 * smoothstep(0.5, 0.75, streak);

  // the film stains the stone green, and under the moss it is black with wet
  // the settled field, not the film itself: the film has a hard front, and would print contour lines
  let film = smoothstep(0.08, 0.95, f.a) * (0.65 + 0.7 * fbm(p * 26.0, 3));
  albedo = mix(albedo, albedo * vec3f(0.5, 0.62, 0.32), film * 0.55);
  let moss = smoothstep(0.05, 0.6, f.g);
  albedo = mix(albedo, vec3f(0.018, 0.022, 0.01), moss);

  let open = mix(0.25, 1.0, v.g);
  let reach = sunReach(p + n * 0.01, frame.sun.xyz);
  let nl = max(dot(n, frame.sun.xyz), 0.0);
  var color = albedo * sky(n, frame) * open * 1.3 + albedo * frame.sunColor.rgb * nl * reach;
  let hv = normalize(frame.sun.xyz + view);
  color += frame.sunColor.rgb * pow(max(dot(n, hv), 0.0), 30.0) * 0.05 * reach * (1.0 - moss);
  return vec4f(color, length(frame.eye.xyz - p) - frame.skyTop.w);
}

/** the ground, a big square; it fades into the dark before its edges show */
@vertex
fn groundVs(@builtin(vertex_index) i: u32) -> Solid {
  let corner = vec2f(f32(i & 1u), f32((i >> 1u) & 1u)) * 2.0 - 1.0;
  let p = vec3f(corner.x * 40.0, GROUND, corner.y * 40.0);
  var o: Solid;
  o.clip = frame.viewProj * vec4f(p, 1.0);
  o.world = p;
  o.normal = vec3f(0, 1, 0);
  return o;
}

/** a wood far out of focus: darkness, and discs of light from gaps in the leaves */
fn discs(dir: vec3f, around: f32, seed: f32) -> vec3f {
  // whole cells round the horizon, wrapped, so that the sky has no seam to orbit past
  let at = vec2f(atan2(dir.x, dir.z) / (2.0 * PI) * around, asin(clamp(dir.y, -1.0, 1.0)) * around / (2.0 * PI));
  let cell = floor(at);
  var sum = vec3f(0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let c = cell + vec2f(f32(x), f32(y));
      let h = hash33(vec3f(c.x - floor(c.x / around) * around, c.y, seed));
      let d = length(at - c - h.xy);
      let r = 0.13 + h.z * 0.17;
      // the rim of a defocused highlight is a little brighter than its middle
      let edge = (1.0 - smoothstep(r - 0.03, r, d)) * (0.75 + 0.5 * smoothstep(r * 0.5, r, d));
      let lit = step(0.7, h.x * 0.6 + h.y * 0.4 + 0.1);
      sum += edge * lit * mix(vec3f(0.05, 0.085, 0.022), vec3f(0.15, 0.15, 0.045), h.z * h.z) * (0.2 + h.y);
    }
  }
  return sum;
}

fn backdrop(dir: vec3f) -> vec3f {
  let up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  var c = mix(vec3f(0.006, 0.009, 0.005), vec3f(0.018, 0.03, 0.014), up);
  let clouds = fbm(vec3f(dir.x * 2.0, dir.y * 3.0, dir.z * 2.0) + 3.0, 3);
  c += vec3f(0.03, 0.05, 0.015) * smoothstep(0.45, 0.75, clouds) * smoothstep(0.42, 0.7, up);
  c += (discs(dir, 90.0, 1.0) + discs(dir, 160.0, 2.0) * 0.6) * smoothstep(0.5, 0.62, up) * (0.04 + 0.34 * smoothstep(0.42, 0.65, clouds));
  return c;
}

@fragment
fn groundFs(i: Solid) -> @location(0) vec4f {
  let p = i.world;
  let view = frame.eye.xyz - p;
  let dist = length(view);
  let n = bump(p, vec3f(0, 1, 0), 5.0, 0.03);

  let dirt = fbm(p * 1.3, 5);
  let fine = fbm(p * 30.0, 3);
  var albedo = mix(vec3f(0.014, 0.0135, 0.012), vec3f(0.036, 0.036, 0.03), dirt) * (0.8 + 0.4 * fine);
  if (all(abs(p + vec3f(0, 0.04, 0)) < vec3f(DOM))) {
    let f = textureSampleLevel(field, smooth3, toVolume(p + vec3f(0, 0.015, 0)), 0.0);
    albedo = mix(albedo, albedo * vec3f(0.5, 0.75, 0.3), smoothstep(0.08, 0.95, f.a));
    albedo = mix(albedo, vec3f(0.012, 0.014, 0.008), smoothstep(0.05, 0.5, f.g));
  }

  // how close the form stands: darkens to contact
  var near = 1.0;
  if (all(abs(p + vec3f(0, 0.04, 0)) < vec3f(DOM))) {
    near = clamp(stone(p + vec3f(0, 0.03, 0)).r * 2.2 + 0.08, 0.08, 1.0);
  }
  let reach = sunReach(p + vec3f(0, 0.015, 0), frame.sun.xyz);
  let nl = max(dot(n, frame.sun.xyz), 0.0);
  var color = albedo * sky(n, frame) * near * 1.3 + albedo * frame.sunColor.rgb * nl * reach;
  // it's wet: a low sheen where the light comes off it
  let hv = normalize(frame.sun.xyz + view / dist);
  color += frame.sunColor.rgb * pow(max(dot(n, hv), 0.0), 90.0) * 0.1 * reach;

  let fade = smoothstep(6.5, 11.0, dist);
  color = mix(color, backdrop(-view / dist), fade);
  return vec4f(color, dist - frame.skyTop.w);
}

struct Screen {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn skyVs(@builtin(vertex_index) i: u32) -> Screen {
  let c = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var o: Screen;
  o.clip = vec4f(c, 1.0, 1.0);
  o.uv = c;
  return o;
}

@fragment
fn skyFs(i: Screen) -> @location(0) vec4f {
  let far = frame.invViewProj * vec4f(i.uv, 1.0, 1.0);
  let dir = normalize(far.xyz / far.w - frame.eye.xyz);
  // already soft, so it reports no blur at all: a silhouette's antialiased pixels average this alpha
  // with their own, and a large number here would hand them a huge blur and ring the form with a halo
  return vec4f(backdrop(dir), 0.0);
}
