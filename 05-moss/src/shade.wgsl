// Moss is mostly leaves shading other leaves, far too small for the distance field to know about.
// This looks at the finished picture instead: how buried each pixel is among its neighbours, and
// whether something stands between it and the sun.

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var scene: texture_2d<f32>;

struct Screen {
  @builtin(position) clip: vec4f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> Screen {
  let c = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: Screen;
  o.clip = vec4f(c * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

fn pixel(at: vec2f) -> vec2i {
  return clamp(vec2i(at), vec2i(0), vec2i(frame.size.xy) - 1);
}

fn tap(at: vec2f) -> f32 {
  return textureLoad(scene, pixel(at), 0).a;
}

/** the thing a pixel shows. One on an edge holds an average of two, so it goes with the nearer neighbour */
fn layerHere(at: vec2f) -> f32 {
  let here = layerAt(pixel(at));
  var best = here;
  var gap = 1e9;
  var around = array(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, -1.0), vec2f(0.0, 1.0));
  for (var k = 0; k < 4; k++) {
    let other = layerAt(pixel(at + around[k]));
    if (other > 0.0 && abs(other - here) < gap) {
      gap = abs(other - here);
      best = other;
    }
  }
  return best;
}

/** depths only compare within one thing: across two, a difference between them means nothing */
fn sameThing(at: vec2f, layer: f32) -> bool {
  return abs(layerAt(pixel(at)) - layer) < 0.25;
}

@fragment
fn fs(i: Screen) -> @location(0) vec4f {
  let center = textureLoad(scene, vec2i(i.clip.xy), 0);
  // the backdrop reports exactly zero, and has nothing to shade
  if (center.a == 0.0) { return center; }

  let px = frame.sun.w / (center.a + frame.skyTop.w); // pixels per unit, this far from the camera
  let spin = fract(sin(dot(i.clip.xy, vec2f(12.9898, 78.233))) * 43758.5453);
  let layer = layerHere(i.clip.xy);

  // buried: taps in opposite pairs, so a slanted surface cancels out and only a real hollow is left
  let reach = 0.03 * SHADE;
  var buried = 0.0;
  for (var k = 0; k < 6; k++) {
    let a = (f32(k) + spin) * 2.39996;
    let r = (0.15 + 0.85 * sqrt((f32(k) + 0.5) / 6.0)) * reach;
    let step = vec2f(cos(a), sin(a)) * max(r * px, 1.0);
    // a pair only cancels a slope if both of it count, so it goes as a pair
    if (!sameThing(i.clip.xy + step, layer) || !sameThing(i.clip.xy - step, layer)) { continue; }
    let one = center.a - tap(i.clip.xy + step);
    let two = center.a - tap(i.clip.xy - step);
    // a neighbour far nearer than this is something else passing in front
    let near = (1.0 - smoothstep(reach * 1.5, reach * 3.0, max(one, two)));
    buried += clamp((one + two) / (reach * 0.5), 0.0, 1.0) * near;
  }
  buried /= 6.0;

  // shadowed: walk towards the sun, and see if the picture ever gets in front of the walk
  let light = frame.light.xyz;
  var shadow = 0.0;
  for (var k = 0; k < 9; k++) {
    let s = (f32(k) + spin + 0.4) / 9.0;
    let along = (s * s * 0.07 + 0.003) * SHADE;
    let at = i.clip.xy + light.xy * along * px;
    if (!sameThing(at, layer)) { continue; }
    let height = center.a + light.z * along;
    let gap = height - tap(at);
    shadow = max(shadow, smoothstep(0.002 * SHADE, 0.009 * SHADE, gap) * (1.0 - smoothstep(0.05 * SHADE, 0.11 * SHADE, gap)));
  }

  // ground running off to the horizon changes depth so fast from pixel to pixel that it looks like
  // occlusion, and there is no leaf-sized detail out there to shade anyway
  let close = 1.0 - smoothstep(2.0, 4.0, center.a);
  let ambient = 1.0 - 0.72 * smoothstep(0.02, 0.6, buried) * close;
  return vec4f(center.rgb * ambient * (1.0 - 0.55 * shadow * close), center.a);
}
