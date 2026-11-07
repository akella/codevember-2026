// Run once per form: a grid of signed distances, for the mesh to come from and for damp.wgsl to read.

struct Bake {
  n: u32,
  form: u32,
  sunX: f32,
  sunY: f32,
  sunZ: f32,
};

@group(0) @binding(0) var<uniform> bake: Bake;
@group(0) @binding(1) var<storage, read_write> sdf: array<f32>;

@compute @workgroup_size(4, 4, 4)
fn distance(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(bake.n))) { return; }
  let p = (vec3f(id) + 0.5) / f32(bake.n) * 2.0 * DOM - DOM;
  // the ground is part of what moss can walk on, though only the form is drawn from this mesh
  sdf[(id.z * bake.n + id.y) * bake.n + id.x] = min(form(p, bake.form), p.y - GROUND);
}
