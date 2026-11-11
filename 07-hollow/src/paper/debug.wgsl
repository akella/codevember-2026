// Flat looks at what the paper is cut from: the distance map, or the silhouette the mesh rasters to.

struct D {
  /** 1 distance, 2 shape; whether balls and trail count; band spacing; band offset */
  view: vec4f,
  /** width, height, and the range of distances the sheets are cut at */
  res: vec4f,
};

@group(0) @binding(0) var<uniform> d: D;
@group(0) @binding(1) var composed: texture_2d<f32>;
@group(0) @binding(2) var body: texture_2d<f32>;
@group(0) @binding(3) var mask: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var o: VOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.uv = p;
  return o;
}

/** a line about `px` pixels wide along the zero of `v`, which changes by `w` a pixel */
fn line(v: f32, w: f32, px: f32) -> f32 {
  return 1.0 - smoothstep(0.0, w * px, abs(v));
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  // the map spans the frame's opening, fitted into the canvas
  let aspect = d.res.x / d.res.y;
  let m = in.uv * vec2f(max(aspect, 1.0), max(1.0 / aspect, 1.0));
  let uv = vec2f(m.x, -m.y) * 0.5 + 0.5;
  let inMap = all(abs(m) < vec2f(1.0));
  let q = clamp(uv, vec2f(0.0), vec2f(1.0));
  let dc = textureSampleLevel(composed, samp, q, 0.0).r;
  let db = textureSampleLevel(body, samp, q, 0.0).r;
  let sd = select(db, dc, d.view.y > 0.5);
  let shape = textureSampleLevel(mask, samp, q, 0.0).r;
  // lines, worked out before any branching so their derivatives hold
  let zero = line(sd, fwidth(sd), 1.5);
  let bands = (sd - d.view.w) / d.view.z;
  let cuts = step(d.res.z - 0.5 * d.view.z, sd) * step(sd, d.res.w + 0.5 * d.view.z);
  // the width from the bands themselves: fract jumps a whole band where it wraps
  let band = line(fract(bands + 0.5) - 0.5, fwidth(bands), 1.0) * cuts;

  var col = vec3f(0.0);
  if (d.view.x < 1.5) {
    // inside warm, outside cool, dark at the outline; a line where each sheet is cut
    col = select(vec3f(0.35, 0.62, 0.9), vec3f(0.92, 0.55, 0.3), sd < 0.0);
    col *= 1.0 - exp(-10.0 * abs(sd));
    col *= 0.85 + 0.15 * cos(sd * 40.0);
    col = mix(col, vec3f(0.05), band * 0.75);
    col = mix(col, vec3f(1.0), zero);
  } else {
    // the raw silhouette, with the distance map's outline over it in red: any gap between them is the field
    col = mix(vec3f(0.1, 0.11, 0.13), vec3f(0.93, 0.92, 0.9), shape);
    col = mix(col, vec3f(0.95, 0.2, 0.15), zero);
  }
  if (!inMap) { col = vec3f(0.03); }
  // gamma
  return vec4f(pow(col, vec3f(1.0 / 2.2)), 1.0);
}
