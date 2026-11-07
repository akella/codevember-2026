// One old stone: a cube whose faces have bowed a little, with worn edges and chips out of them.

struct Bake {
  n: u32,
  seed: f32,
};

@group(0) @binding(0) var<uniform> bake: Bake;
@group(0) @binding(1) var<storage, read_write> sdf: array<f32>;

fn block(p: vec3f, seed: f32) -> f32 {
  let bow = vec3f(fbm(p * 0.75 + seed, 2), fbm(p * 0.75 + seed + 7.0, 2), fbm(p * 0.75 + seed + 13.0, 2)) - 0.5;
  let q = p + bow * 0.2;
  let box = boxDistance(q, vec3f(STONE), 0.2);

  // how much of an edge this is: the second largest coordinate is high only near one
  let a = abs(q);
  let middle = max(min(a.x, a.y), min(max(a.x, a.y), a.z));
  let edge = smoothstep(0.62, 0.96, middle);
  let chips = max(fbm(q * 2.6 + seed + 3.0, 3) - 0.5, 0.0) * 0.42 * edge;

  let wear = fbm(q * 2.9 + seed, 3) - 0.5;
  let pits = fbm(q * 11.0 + seed + 9.0, 3) - 0.5;
  return box - wear * 0.05 - pits * 0.004 + chips;
}

@compute @workgroup_size(4, 4, 4)
fn distance(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(bake.n))) { return; }
  let p = (vec3f(id) + 0.5) / f32(bake.n) * 2.0 * DOM - DOM;
  sdf[(id.z * bake.n + id.y) * bake.n + id.x] = block(p, bake.seed);
}
