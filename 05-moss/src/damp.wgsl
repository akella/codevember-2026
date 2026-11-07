// Reads the distance grid and writes the volume everything else samples: r distance to the form,
// g openness (0 in a crevice, 1 in the open), b damp, a distance to the form or the ground.

struct Bake {
  n: u32,
  form: u32,
  sunX: f32,
  sunY: f32,
  sunZ: f32,
};

@group(0) @binding(0) var<uniform> bake: Bake;
@group(0) @binding(1) var<storage, read> sdf: array<f32>;
@group(0) @binding(2) var volume: texture_storage_3d<rgba16float, write>;

fn at(i: vec3i) -> f32 {
  let n = i32(bake.n);
  let c = clamp(i, vec3i(0), vec3i(n - 1));
  return sdf[(c.z * n + c.y) * n + c.x];
}

@compute @workgroup_size(4, 4, 4)
fn damp(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(bake.n))) { return; }
  let i = vec3i(id);
  let cell = 2.0 * DOM / f32(bake.n);
  let p = (vec3f(id) + 0.5) * cell - DOM;
  let d = at(i);

  let g = vec3f(at(i + vec3i(1, 0, 0)) - at(i - vec3i(1, 0, 0)),
                at(i + vec3i(0, 1, 0)) - at(i - vec3i(0, 1, 0)),
                at(i + vec3i(0, 0, 1)) - at(i - vec3i(0, 0, 1)));
  let n = g / max(length(g), 1e-5);

  // walk out along the normal: if the distance grows slower than the walk, something is closing in
  var open = 0.0;
  var weight = 0.0;
  for (var k = 1; k <= 6; k++) {
    let h = 0.035 * f32(k * k) * 0.5 + 0.02;
    let q = i + vec3i(round(n * h / cell));
    let w = 1.0 / f32(k);
    open += w * clamp(at(q) / h, 0.0, 1.0);
    weight += w;
  }
  open /= weight;

  let sun = normalize(vec3f(bake.sunX, bake.sunY, bake.sunZ));
  let ledge = smoothstep(0.35, 0.9, n.y);
  let sheltered = 1.0 - open;
  let scorched = max(dot(n, sun), 0.0);
  let patches = fbm(p * 2.3 + 11.0, 4);
  var wet = 0.15 + sheltered * 1.6 + ledge * 0.42 - scorched * 0.14 + (patches - 0.5) * 0.85;
  // low down the stone stays wet for longer
  wet += smoothstep(0.1, -1.0, p.y) * 0.15;
  // the ground is only damp near the foot of the form, so the moss runs out in a ragged skirt
  let body = form(p, bake.form);
  if (p.y < GROUND + 0.1) {
    let reach = 0.03 + fbm(p * 3.4 + 21.0, 4) * 0.5;
    wet = min(wet, 0.75 - smoothstep(reach * 0.5, reach, body) * 0.75);
  }

  textureStore(volume, id, vec4f(body, open, clamp(wet, 0.0, 1.0), d));
}
