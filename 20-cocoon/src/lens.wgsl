// What lies off the focus is spread over a disc, each half-size pixel by its own amount. The blur of a pixel
// is that of the silk in it, not of the black behind: `soft` holds blur x cover and cover.
struct Lens { size: vec4f }                 // half the picture's size, the widest blur (half-size pixels)
@group(0) @binding(0) var<uniform> lens: Lens;
@group(0) @binding(1) var sharp: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var soft: texture_2d<f32>;

struct Out { @builtin(position) clip: vec4f, @location(0) uv: vec2f }
@vertex
fn screen(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return Out(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}

fn blurOf(s: vec2f) -> f32 { return s.x / max(s.y, 1e-3); }

// colour, and the blur's radius in half-size pixels (nearer than the focus: negative)
@fragment
fn half_(o: Out) -> @location(0) vec4f {
  let own = textureSampleLevel(soft, smp, o.uv, 0.0).xy;
  // black beside a hair takes the hair's, so that averaging the two later doesn't make the hair sharper
  let t = 1.0 / vec2f(textureDimensions(soft));
  var round = own * 2.0;
  for (var i = 0; i < 4; i++) {
    let s = vec2f(f32(i & 1) * 2.0 - 1.0, f32(i >> 1) * 2.0 - 1.0);
    round += textureSampleLevel(soft, smp, o.uv + s * t * 2.0, 0.0).xy + 0.5 * textureSampleLevel(soft, smp, o.uv + s * t * 5.0, 0.0).xy;
  }
  let b = select(0.0, mix(blurOf(round), blurOf(own), smoothstep(0.2, 0.9, own.y)), round.y > 1e-3);
  return vec4f(textureSampleLevel(sharp, smp, o.uv, 0.0).rgb, b * 0.5);
}

// the same again, smaller
@fragment
fn small(o: Out) -> @location(0) vec4f { return textureSampleLevel(sharp, smp, o.uv, 0.0); }

const COUNT = 96;
const INWARD = 0.75;                        // 0.5 spaces the taps evenly: more than that, denser near the middle
@fragment
fn gather(o: Out) -> @location(0) vec4f {
  let mid = textureSampleLevel(sharp, smp, o.uv, 0.0);
  let most = lens.size.z;
  // how much of it is black or only a hair: nothing to stop what is behind
  let gap = 64.0 * (1.0 - smoothstep(0.2, 0.9, textureSampleLevel(soft, smp, o.uv, 0.0).y));
  var sum = vec3f(0.0);
  var cover = 0.0;
  var all = 0.0;
  for (var i = 0; i < COUNT; i++) {
    let t = (f32(i) + 0.5) / f32(COUNT);
    let r = pow(t, INWARD) * most;
    let area = 2.0 * r * most * INWARD * pow(t, INWARD - 1.0) / f32(COUNT);
    let a = f32(i) * 2.39996323;
    // from a copy as coarse as the taps are far apart, or a hair would come out as many
    let c = textureSampleLevel(sharp, smp, o.uv + vec2f(cos(a), sin(a)) * r / lens.size.xy, log2(max(1.0, 1.5 * sqrt(area))));
    var b = abs(c.w);
    // what is behind doesn't spill over what is sharp in front
    if (c.w > mid.w) { b = min(b, abs(mid.w) * 2.0 + gap); }
    let reach = clamp(b - r + 1.0, 0.0, 1.0);
    let w = reach * area / (b * b + b + 0.3333);        // a disc with a soft rim, all of it adding up to one
    let s = smoothstep(0.35, 0.8, b);
    sum += c.rgb * w * s;
    cover += w * s;
    all += w;
  }
  let k = 1.0 / max(all, 1.0);
  return vec4f(sum * k, min(cover * k, 1.0));
}

@group(0) @binding(4) var spread: texture_2d<f32>;
@fragment
fn lay(o: Out) -> @location(0) vec4f {
  let c = textureSampleLevel(sharp, smp, o.uv, 0.0).rgb;
  let b = abs(blurOf(textureSampleLevel(soft, smp, o.uv, 0.0).xy)) * 0.5;
  // a wide tent: half-size pixels don't show
  let t = 1.0 / vec2f(textureDimensions(spread));
  var s = vec4f(0.0);
  for (var i = 0; i < 4; i++) { s += 0.25 * textureSampleLevel(spread, smp, o.uv + (vec2f(f32(i & 1), f32(i >> 1)) - 0.5) * t, 0.0); }
  return vec4f(c * (1.0 - s.a) * (1.0 - smoothstep(0.35, 0.8, b)) + s.rgb, 1.0);
}
