// Temporal accumulation for the rolling tesseract. The trace says where each pixel's surface was last
// frame (beams and panes carried along with their corners), so history follows the tesseract as it
// rolls. While nothing moves the history grows into a converged image. In motion it is capped, the
// tesseract's short and the studio's longer, and kept within what this frame's neighbourhood allows,
// so a moving shadow doesn't leave a trail. Then an edge-aware blur takes the grain off what is left.

@group(0) @binding(1) var current: texture_2d<f32>;
@group(0) @binding(2) var geo: texture_2d<f32>;
@group(0) @binding(3) var expectedTex: texture_2d<f32>;
@group(0) @binding(4) var history: texture_2d<f32>;
@group(0) @binding(5) var historyGeo: texture_2d<f32>;
@group(0) @binding(6) var outHistory: texture_storage_2d<rgba16float, write>;
// the first pane's reflection, gathered apart with its own history (see primaryHit's mirror), and the
// two together for the blur and the upscale
@group(0) @binding(20) var currentR: texture_2d<f32>;
@group(0) @binding(21) var historyR: texture_2d<f32>;
@group(0) @binding(22) var outHistoryR: texture_storage_2d<rgba16float, write>;
@group(0) @binding(23) var outSum: texture_storage_2d<rgba16float, write>;

fn reflection(id: vec2u, cls: f32, uvm: vec2f) -> vec4f {
  let cr = textureLoad(currentR, id, 0).rgb;
  if (cls < 5.0 || u.extra.z < 0.5) {
    return vec4f(0.0);
  }
  var h = vec4f(0.0);
  if (u.look.z > 0.5) {
    h = textureLoad(historyR, id, 0);
  } else if (all(uvm > vec2f(0.0)) && all(uvm < vec2f(1.0))) {
    // bilinear from where the mirror image was, from pixels that were glass then too
    let hi = vec2i(u.prevRes.xy) - 1;
    let fp = prevGridOf(uvm) * u.prevRes.xy - 0.5;
    let base = vec2i(floor(fp));
    let fr = fract(fp);
    var sum = vec4f(0.0);
    var weight = 0.0;
    for (var k = 0; k < 4; k++) {
      let o = vec2i(k & 1, k >> 1);
      let px = clamp(base + o, vec2i(0), hi);
      let bw = select(1.0 - fr.x, fr.x, o.x == 1) * select(1.0 - fr.y, fr.y, o.y == 1);
      if (bw > 0.0 && textureLoad(historyGeo, px, 0).y >= 5.0) {
        sum += textureLoad(historyR, px, 0) * bw;
        weight += bw;
      }
    }
    if (weight > 0.01) {
      h = sum / weight;
    }
    // held to what this image's reflections around allow
    let top = vec2i(u.res.xy) - 1;
    var m1 = vec3f(0.0);
    var m2 = vec3f(0.0);
    for (var j = -1; j <= 1; j++) {
      for (var i = -1; i <= 1; i++) {
        let q = textureLoad(currentR, clamp(vec2i(id) + vec2i(i, j), vec2i(0), top), 0).rgb;
        m1 += q;
        m2 += q * q;
      }
    }
    m1 /= 9.0;
    let sd = sqrt(max(m2 / 9.0 - m1 * m1, vec3f(0.0)));
    h = vec4f(clamp(h.rgb, m1 - 2.5 * sd, m1 + 2.5 * sd), h.a);
  }
  let n = min(h.a + 1.0, select(u.extra.y, u.prevEye.w, u.look.z > 0.5));
  return vec4f(mix(h.rgb, cr, 1.0 / n), n);
}

// how far a tap of last frame is from what this pixel expects there: 0 is the same, 1 or more is not
fn mismatch(px: vec2i, cls: f32, expected: f32) -> f32 {
  let g = textureLoad(historyGeo, px, 0);
  if (g.y != cls) {
    return 1.0;
  }
  if (cls == 0.0) {
    return 0.0;
  }
  return abs(g.x - expected) / (0.03 * expected);
}

@compute @workgroup_size(8, 8)
fn accumulate(@builtin(global_invocation_id) id: vec3u) {
  if (f32(id.x) >= u.res.x || f32(id.y) >= u.res.y) {
    return;
  }
  let traced = textureLoad(current, id.xy, 0);
  // a pixel of the sweep's checkerboard that sat this image out
  let skipped = traced.a == 0.0;
  var c = traced.rgb;
  let g = textureLoad(geo, id.xy, 0);
  let more = textureLoad(expectedTex, id.xy, 0);
  let expected = more.r;
  let uv = g.zw;

  var hist = vec4f(0.0);
  if (u.look.z > 0.5) {
    // nothing moved, so every pixel's history is its own
    hist = textureLoad(history, id.xy, 0);
  } else if (all(uv > vec2f(0.0)) && all(uv < vec2f(1.0))) {
    // bilinear from last frame, using only the taps that saw the same surface at the same distance,
    // so the beams' history doesn't bleed onto the floor beside them; if none do, the best of the 3x3.
    // Last frame may have been traced at another size.
    let hi = vec2i(u.prevRes.xy) - 1;
    let fp = prevGridOf(uv) * u.prevRes.xy - 0.5;
    let base = vec2i(floor(fp));
    let fr = fract(fp);
    var sum = vec4f(0.0);
    var weight = 0.0;
    for (var k = 0; k < 4; k++) {
      let o = vec2i(k & 1, k >> 1);
      let px = clamp(base + o, vec2i(0), hi);
      let bw = select(1.0 - fr.x, fr.x, o.x == 1) * select(1.0 - fr.y, fr.y, o.y == 1);
      if (bw > 0.0 && mismatch(px, g.y, expected) < 1.0) {
        sum += textureLoad(history, px, 0) * bw;
        weight += bw;
      }
    }
    if (weight > 0.01) {
      hist = sum / weight;
    } else {
      let centre = vec2i(prevGridOf(uv) * u.prevRes.xy);
      var best = 1.0;
      for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
          let px = clamp(centre + vec2i(i, j), vec2i(0), hi);
          let m = mismatch(px, g.y, expected);
          if (m < best) {
            best = m;
            hist = textureLoad(history, px, 0);
          }
        }
      }
    }
  }
  var most = u.prevEye.w;
  if (u.look.z < 0.5 && hist.a > 0.0) {
    // the studio, bare or behind glass, and what is beyond it
    if (g.y == 3.0 || g.y == 7.0 || g.y == 0.0) {
      most = u.kinds.w;
    }
    // Polished beams: a reflection doesn't travel with the surface it is seen in, so history carried
    // along with the surface smears it. They are the least noisy thing here, and get the least history.
    if (g.y == 1.0 || g.y == 5.0) {
      most = min(most, u.more.x);
    }
    // Glass over the sweep: its history is carried with the sweep behind it, but what makes it glass
    // is the reflection in front, which moves with the pane. Kept long, the bars reflected in it
    // smeared away and it read as tinted plastic.
    if (g.y == 7.0 && u.extra.z < 0.5) {
      most = min(most, u.more.w);
    }
    // this frame's 3x3, as mean and spread, bounds what the history may be
    let hi = vec2i(u.res.xy) - 1;
    var m1 = vec3f(0.0);
    var m2 = vec3f(0.0);
    var count = 0.0;
    for (var j = -1; j <= 1; j++) {
      for (var i = -1; i <= 1; i++) {
        let q = textureLoad(current, clamp(vec2i(id.xy) + vec2i(i, j), vec2i(0), hi), 0);
        let on = step(0.5, q.a);
        m1 += q.rgb * on;
        m2 += q.rgb * q.rgb * on;
        count += on;
      }
    }
    count = max(count, 1.0);
    m1 /= count;
    let sd = sqrt(max(m2 / count - m1 * m1, vec3f(0.0)));
    let wide = 2.5;
    hist = vec4f(clamp(hist.rgb, m1 - wide * sd, m1 + wide * sd), hist.a);
  }
  if (skipped) {
    if (hist.a > 0.0) {
      // keeps what it had (already held to what its traced neighbours allow, so shadows don't trail)
      textureStore(outHistory, id.xy, vec4f(hist.rgb, min(hist.a, most)));
      textureStore(outHistoryR, id.xy, vec4f(0.0));
      textureStore(outSum, id.xy, vec4f(hist.rgb, min(hist.a, most)));
      return;
    }
    // nothing to keep: its four neighbours were traced
    let hi = vec2i(u.res.xy) - 1;
    var sum = vec4f(0.0);
    for (var k = 0; k < 4; k++) {
      let o = vec2i(select(-1, 1, k == 1) * i32(k < 2), select(-1, 1, k == 3) * i32(k >= 2));
      let q = textureLoad(current, clamp(vec2i(id.xy) + o, vec2i(0), hi), 0);
      sum += vec4f(q.rgb, 1.0) * step(0.5, q.a);
    }
    c = sum.rgb / max(sum.a, 1.0);
  }
  let n = min(hist.a + 1.0, most);
  let through = mix(hist.rgb, c, 1.0 / n);
  let r = reflection(id.xy, g.y, more.yz);
  textureStore(outHistory, id.xy, vec4f(through, n));
  textureStore(outHistoryR, id.xy, r);
  textureStore(outSum, id.xy, vec4f(through + r.rgb, n));
}

// Edge-aware a-trous blur (after Dammertz et al. and SVGF): a 3x3 kernel at spacing 1, 2, 4, 8, taking
// neighbours only where they are the same kind of surface, on the same plane, facing the same way and
// not much brighter or darker than the noise here explains.
@group(0) @binding(10) var src: texture_2d<f32>;
@group(0) @binding(11) var geoNow: texture_2d<f32>;
@group(0) @binding(12) var normals: texture_2d<f32>;
@group(0) @binding(13) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(14) var<uniform> spacing: vec4f;

fn worldAt(px: vec2i, dist: f32) -> vec3f {
  return u.eye.xyz + rayAt(screenOf((vec2f(px) + 0.5) * u.res.zw)) * dist;
}

fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

@compute @workgroup_size(8, 8)
fn atrous(@builtin(global_invocation_id) id: vec3u) {
  if (f32(id.x) >= u.res.x || f32(id.y) >= u.res.y) {
    return;
  }
  let p = vec2i(id.xy);
  let hi = vec2i(u.res.xy) - 1;
  let c = textureLoad(src, p, 0);
  let g = textureLoad(geoNow, p, 0);
  // as the history grows the blur gives way to it, and is skipped once it has
  let samples = c.a * u.fwd.w;
  // The tesseract only gets the fine passes: the wide ones wiped the reflections off its glass and
  // chrome, which are detail inside one surface that nothing here can tell from noise.
  // The beams are blurred along themselves only: a highlight runs the length of a beam and is thin
  // across it, and along a beam the normal doesn't change, so a very tight stop on the normal takes
  // neighbours up and down the beam and none across.
  let studio = g.y == 3.0;
  let beam = g.y == 1.0 || g.y == 5.0;
  if (u.denoise.x <= 0.0 || samples >= u.denoise.z || g.y == 0.0 || (beam && spacing.x > u.pane.z) || (!studio && !beam && spacing.x > u.prevRes.w)) {
    textureStore(dst, p, c);
    return;
  }
  let step = i32(spacing.x);
  let n = textureLoad(normals, p, 0).xyz;
  let x = worldAt(p, g.x);
  let l = luminance(c.rgb);
  // noise here, from the spread of brightness around it
  var m1 = 0.0;
  var m2 = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let q = luminance(textureLoad(src, clamp(p + vec2i(i, j), vec2i(0), hi), 0).rgb);
      m1 += q;
      m2 += q * q;
    }
  }
  let sd = sqrt(max(m2 / 9.0 - (m1 / 9.0) * (m1 / 9.0), 0.0));
  let pixel = g.x * 2.0 * u.up.w * u.res.w * stretchAt((vec2f(p) + 0.5) * u.res.zw);
  var sum = vec3f(0.0);
  var wsum = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let q = clamp(p + vec2i(i, j) * step, vec2i(0), hi);
      let cq = textureLoad(src, q, 0);
      let gq = textureLoad(geoNow, q, 0);
      let k = select(0.5, 1.0, i == 0) * select(0.5, 1.0, j == 0);
      if (gq.y != g.y) {
        continue;
      }
      let nq = textureLoad(normals, q, 0).xyz;
      let off = abs(dot(n, worldAt(q, gq.x) - x)) / (pixel * f32(step) + 1e-6);
      let w = k * exp(-off) * pow(max(dot(n, nq), 0.0), select(32.0, 2000.0, beam)) * exp(-abs(luminance(cq.rgb) - l) / (u.denoise.y * sd + 1e-3));
      sum += cq.rgb * w;
      wsum += w;
    }
  }
  let blurred = sum / max(wsum, 1e-6);
  let keep = smoothstep(u.denoise.z * 0.25, u.denoise.z, samples);
  textureStore(dst, p, vec4f(mix(mix(c.rgb, blurred, u.denoise.x), c.rgb, keep), c.a));
}

@group(0) @binding(7) var shown: texture_2d<f32>;
@group(0) @binding(8) var linear: sampler;

struct V {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> V {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return V(vec4f(xy * 2.0 - 1.0, 0.0, 1.0), vec2f(xy.x, 1.0 - xy.y));
}

// Khronos PBR neutral: keeps a white sweep white and the metal's colour true
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
  c *= 1.0 - 0.25 * dot(v, v);
  c = srgb(clamp(neutral(c), vec3f(0.0), vec3f(1.0)));
  let n = fract(sin(dot(in.pos.xy, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
  return vec4f(c + n / 255.0, 1.0);
}
