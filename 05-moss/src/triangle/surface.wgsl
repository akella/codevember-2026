// A stone never changes, so all the noise that makes its surface is worked out once per vertex here.
// The mesh is dense enough that this looks the same as doing it per pixel, at a fraction of the cost.

@group(0) @binding(0) var<storage, read> positions: array<f32>;
@group(0) @binding(1) var<storage, read> normals: array<f32>;
@group(0) @binding(2) var<storage, read> owners: array<f32>;
@group(0) @binding(3) var<storage, read_write> shape: array<vec4f>; // normal, then first
@group(0) @binding(4) var<storage, read_write> tone: array<vec4f>;  // albedo, then last
@group(0) @binding(5) var<uniform> scene: Scene;

fn bump(p: vec3f, n: vec3f, scale: f32, amount: f32) -> vec3f {
  let e = 0.5 / scale;
  let c = fbm(p * scale, 3);
  let g = vec3f(fbm((p + vec3f(e, 0, 0)) * scale, 3), fbm((p + vec3f(0, e, 0)) * scale, 3), fbm((p + vec3f(0, 0, e)) * scale, 3)) - c;
  return normalize(n - (g - n * dot(g, n)) * amount / e);
}

@compute @workgroup_size(128)
fn surface(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&owners)) { return; }
  let p = vec3f(positions[i * 3u], positions[i * 3u + 1u], positions[i * 3u + 2u]);
  let flat3 = vec3f(normals[i * 3u], normals[i * 3u + 1u], normals[i * 3u + 2u]);
  let seed = scene.lives[u32(owners[i] + 0.5)].z;
  let q = p + seed;

  let n = bump(q, bump(q, normalize(flat3), 5.0, 0.05), 26.0, 0.02);
  let blotch = fbm(q * 1.9 + 5.0, 4);
  var albedo = mix(vec3f(0.135, 0.125, 0.11), vec3f(0.27, 0.25, 0.215), blotch);
  // water tracks down the faces
  let streak = fbm(q * vec3f(7.0, 0.8, 7.0), 3);
  albedo *= 1.0 - 0.36 * smoothstep(0.48, 0.74, streak);

  let here = patchAt(p, seed);
  shape[i] = vec4f(n, here.first);
  tone[i] = vec4f(albedo, here.last);
}
