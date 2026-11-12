// Temporal accumulation: each new path traced frame is averaged into the history, found where the same
// surface was last frame. While the camera holds still that history grows into a converged image; while
// it moves it is capped, trading noise against smear.

@group(0) @binding(1) var current: texture_2d<f32>;
@group(0) @binding(2) var currentDepth: texture_2d<f32>;
@group(0) @binding(3) var history: texture_2d<f32>;
@group(0) @binding(4) var historyDepth: texture_2d<f32>;
@group(0) @binding(5) var linear: sampler;
@group(0) @binding(6) var outHistory: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn accumulate(@builtin(global_invocation_id) id: vec3u) {
  if (f32(id.x) >= u.res.x || f32(id.y) >= u.res.y) {
    return;
  }
  let c = textureLoad(current, id.xy, 0).rgb;
  let t = textureLoad(currentDepth, id.xy, 0).r;
  let ndc = vec2f((f32(id.x) + 0.5) * u.res.z * 2.0 - 1.0, 1.0 - (f32(id.y) + 0.5) * u.res.w * 2.0);
  let rd = normalize(u.fwd.xyz + u.right.xyz * ndc.x * u.right.w + u.up.xyz * ndc.y * u.up.w);
  let sky = t >= BIG * 0.5;
  let wp = u.eye.xyz + rd * select(t, 1e4 / u.shape.w, sky);

  var hist = vec4f(0.0);
  let clip = u.prevViewProj * vec4f(wp, 1.0);
  if (u.extra.y > 0.5) {
    // the camera hasn't moved, so every pixel's history is its own
    hist = textureLoad(history, id.xy, 0);
  } else if (clip.w > 0.0) {
    let uv = vec2f(clip.x / clip.w * 0.5 + 0.5, 0.5 - clip.y / clip.w * 0.5);
    if (all(uv > vec2f(0.0)) && all(uv < vec2f(1.0))) {
      // Bilinear, but only from last frame's pixels that saw the same surface, so a bright beam's
      // history can't bleed into the background beside it. A jittered pixel on an edge hits the beam
      // one frame and what's behind it the next, so if none of the four match, take the best of the 3x3.
      let expected = length(wp - u.prev.xyz);
      let hi = vec2i(u.res.xy) - 1;
      let fp = uv * u.res.xy - 0.5;
      let base = vec2i(floor(fp));
      let fr = fract(fp);
      var sum = vec4f(0.0);
      var weight = 0.0;
      for (var k = 0; k < 4; k++) {
        let o = vec2i(k & 1, k >> 1);
        let px = clamp(base + o, vec2i(0), hi);
        let pd = textureLoad(historyDepth, px, 0).r * u.prev.w;
        let wasSky = pd >= BIG * 0.5 * u.prev.w;
        let same = select(abs(pd - expected) < 0.03 * expected, sky && wasSky, sky || wasSky);
        let bw = select(1.0 - fr.x, fr.x, o.x == 1) * select(1.0 - fr.y, fr.y, o.y == 1);
        if (same && bw > 0.0) {
          sum += textureLoad(history, px, 0) * bw;
          weight += bw;
        }
      }
      if (weight > 0.01) {
        hist = sum / weight;
      } else {
        let centre = vec2i(uv * u.res.xy);
        var best = 0.03;
        for (var j = -1; j <= 1; j++) {
          for (var i = -1; i <= 1; i++) {
            let px = clamp(centre + vec2i(i, j), vec2i(0), hi);
            let pd = textureLoad(historyDepth, px, 0).r * u.prev.w;
            let wasSky = pd >= BIG * 0.5 * u.prev.w;
            let err = select(abs(pd - expected) / expected, select(1.0, 0.0, sky && wasSky), sky || wasSky);
            if (err < best) {
              best = err;
              hist = textureLoad(history, px, 0);
            }
          }
        }
      }
    }
  }
  let n = min(hist.a + 1.0, u.accum.x);
  textureStore(outHistory, id.xy, vec4f(mix(hist.rgb, c, 1.0 / n), n));
}

@group(0) @binding(7) var shown: texture_2d<f32>;

struct V {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> V {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return V(vec4f(xy * 2.0 - 1.0, 0.0, 1.0), vec2f(xy.x, 1.0 - xy.y));
}

// Khronos PBR neutral: keeps white beams white instead of pushing them grey or yellow
fn neutral(c0: vec3f) -> vec3f {
  let start = 0.76;
  let desat = 0.15;
  let x = min(c0.r, min(c0.g, c0.b));
  let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
  var c = c0 - offset;
  let peak = max(c.r, max(c.g, c.b));
  if (peak < start) {
    return c;
  }
  let d = 1.0 - start;
  let np = 1.0 - d * d / (peak + d - start);
  c *= np / peak;
  let g = 1.0 - 1.0 / (desat * (peak - np) + 1.0);
  return mix(c, vec3f(np), g);
}

fn srgb(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}

@fragment
fn fs(in: V) -> @location(0) vec4f {
  var c = textureSampleLevel(shown, linear, in.uv, 0.0).rgb * u.look.x;
  let v = in.uv - 0.5;
  c *= 1.0 - 0.35 * dot(v, v);
  c = srgb(clamp(neutral(c), vec3f(0.0), vec3f(1.0)));
  // dither so dark gradients don't band
  let n = fract(sin(dot(in.pos.xy, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
  return vec4f(c + n / 255.0, 1.0);
}
