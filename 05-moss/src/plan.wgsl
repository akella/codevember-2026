// What each shoot will be. Its height comes from the cushion it belongs to, and it leans out from
// the middle of that cushion, which is what makes a mass of shoots read as soft domes.

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> roots: array<vec4f>; // position, then normal
@group(0) @binding(2) var<storage, read_write> shoots: array<Shoot>;
@group(0) @binding(3) var volume: texture_3d<f32>;
@group(0) @binding(4) var smooth3: sampler;

fn stone(p: vec3f) -> vec4f {
  return textureSampleLevel(volume, smooth3, toVolume(p), 0.0);
}

/** how much sun gets from here, marching the distance field */
fn sunReach(p: vec3f, sun: vec3f) -> f32 {
  var t = 0.03;
  var lit = 1.0;
  for (var i = 0; i < 28; i++) {
    let q = p + sun * t;
    if (any(abs(q) > vec3f(DOM))) { break; }
    let d = stone(q).r;
    lit = min(lit, 3.2 * d / t + 0.5);
    t += clamp(d, 0.012, 0.2);
  }
  return smoothstep(0.0, 1.0, clamp(lit, 0.0, 1.0));
}

@compute @workgroup_size(128)
fn plan(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&shoots)) { return; }
  let p = roots[i * 2u].xyz;
  let n = roots[i * 2u + 1u].xyz;
  let seed = hash1(i);
  let seed2 = hash1(i + 7919u);
  let rank = hash1(i + 104729u);

  let v = stone(p + n * 0.02);

  // two scales of dome: big cushions, and the tufts that make them up
  let wob = (vec3f(fbm(p * 4.0, 2), fbm(p * 4.0 + 9.0, 2), fbm(p * 4.0 + 19.0, 2)) - 0.5) * 0.7;
  let big = worley(p * 8.5 + wob);
  let small = worley(p * 24.0 + wob * 2.0);
  let kind = kindAt(p, big.id, small.id);
  let dome = 1.0 - smoothstep(0.05, 0.95, big.d);
  let tuft = 1.0 - smoothstep(0.1, 0.9, small.d);

  // a pelt, not a pile: it follows the stone, and only deepens where the damp collects
  var height = 0.02 + dome * dome * 0.034 + tuft * 0.012;
  height *= 0.5 + v.b * 1.1;
  // the kinds differ most in how tall they stand
  height *= select(select(1.0, 1.3, kind > 0.5), 0.55, kind > 1.5);
  // and neighbours are never level, which is where the dark between the tips comes from
  height *= 0.74 + 0.42 * rank;

  let outBig = -big.to / max(length(big.to), 1e-4);
  let outSmall = -small.to / max(length(small.to), 1e-4);
  var out = outBig * (0.3 + 0.7 * (1.0 - dome)) + outSmall * 0.35;
  out -= n * dot(out, n);

  let wander = (hash33(vec3f(f32(i), 3.0, 1.0)) - 0.5) * 0.6;
  let lift = vec3f(0.0, 1.0, 0.0) * 0.25;
  // the feathery kind lies over; the others stand
  let bend = select(1.0, 2.6, kind > 1.5);
  let lean = normalize(n + (out * 0.9 + wander) * bend + lift);

  let reach = sunReach(p + n * (0.05 + height), frame.sun.xyz) * mix(1.0, smoothstep(-0.05, 0.3, n.y), step(p.y, GROUND + 0.02));
  let valley = 0.3 + 0.7 * smoothstep(0.0, 0.7, dome + tuft * 0.35);
  let open = mix(v.g, 1.0, 0.1) * valley * (0.3 + 0.7 * rank * rank);

  // cushions come up from the middle, so the edge of the colony is scattered domes, not a line
  let wait = 0.03 + 0.34 * seed2 + 0.42 * (1.0 - dome);

  shoots[i].root = vec4f(p, height);
  shoots[i].up = vec4f(n, rank);
  shoots[i].lean = vec4f(lean, reach);
  // fruit comes in colonies on the upright kinds, from the tallest shoots
  let colony = smoothstep(0.5, 0.68, fbm(p * 3.3 + 70.0, 3));
  let fruits = kind < 1.5 && rank > 0.5 && hash1(i + 31337u) < 0.022 * colony;

  shoots[i].look = vec4f(seed, kind + seed2 * 0.999 + select(0.0, 4.0, fruits), open, wait);
}
