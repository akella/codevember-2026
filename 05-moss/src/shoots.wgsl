// The population, shared by plan.wgsl (once per form, what each shoot will be when grown), cull.wgsl
// (every frame, which are alive and in view) and moss.wgsl (drawing them).

struct Shoot {
  root: vec4f, // xyz, w full height
  up: vec4f,   // xyz surface normal, w rank among its neighbours, 0 to 1
  lean: vec4f, // xyz where the tip points, w sun reaching it
  look: vec4f, // x seed, y species 0 to 2 plus 4 if it fruits, z openness, w moss level it waits for, or once live on a stone its layer
};

// three kinds grow side by side. The choice mostly belongs to the cushion, so that borders run round
// domes, and a little to the tuft, so that near a border the kinds pick their way into each other
fn kindAt(p: vec3f, cushion: f32, tuft: f32) -> f32 {
  let a = (fbm(p * 1.9 + 40.0, 3) - 0.5) * 3.4 + (cushion - 0.5) * 0.9 + (tuft - 0.5) * 0.8;
  let b = (fbm(p * 2.6 + 90.0, 3) - 0.5) * 3.6 + (fract(cushion * 7.3) - 0.5) * 0.7 + (fract(tuft * 5.1) - 0.5) * 0.7;
  if (b > 0.42) { return 2.0; }
  return select(0.0, 1.0, a > 0.12);
}
