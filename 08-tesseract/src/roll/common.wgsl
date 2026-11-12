struct U {
  prevViewProj: mat4x4f,
  eye: vec4f,     // xyz, frame
  right: vec4f,   // xyz, tan of half the horizontal fov
  up: vec4f,      // xyz, tan of half the vertical fov
  fwd: vec4f,     // xyz, paths per pixel
  res: vec4f,     // w, h, 1/w, 1/h
  prevEye: vec4f, // xyz, most frames in the history
  bound: vec4f,   // sphere around the tesseract
  look: vec4f,    // exposure, bounces, still, light count
  matA: vec4f,    // colour (reflectance for metal, albedo otherwise), roughness
  matB: vec4f,
  floor: vec4f,   // albedo, roughness of its coat
  glass: vec4f,   // tint, glazed squares
  studio: vec4f,  // back wall z, cove radius, ambient, firefly clamp
  kinds: vec4f,   // A is metal, B is metal, view, most frames in the floor's history
  denoise: vec4f, // strength, edge stop on brightness, samples at which it gives way, exact softbox light on the sweep
  full: vec4f,    // output w, h, 1/w, 1/h
  jit: vec4f,     // this frame's offset of the output's samples in its pixels, most frames in its history, reset
  warpX: vec4f,   // the traced grid across the screen: screen span a0..a1 takes grid span d0..d1
  warpY: vec4f,
  prevWarpX: vec4f,
  prevWarpY: vec4f,
  more: vec4f,    // most frames in a beam's history in motion: traced, full size; inner panes only tint; most frames for glass over the sweep
  pane: vec4f,    // the glass's index of refraction, paths per pixel on the tesseract, widest blur spacing along beams, which half of the grid to trace (0 all)
  prevRes: vec4f, // traced w, h last frame (the traced size can change from frame to frame), blue noise dimensions, widest blur spacing on the tesseract
  // The traced image on show: the camera, grid and size it was traced with. Tracing can run at half
  // the frame rate, so it may be a frame or two older than what the full size passes draw.
  tViewProj: mat4x4f,
  tEye: vec4f,
  tRight: vec4f,
  tUp: vec4f,
  tFwd: vec4f,
  tRes: vec4f,
  tWarpX: vec4f,
  tWarpY: vec4f,
  fx: vec4f,      // softbox pattern (0 none, 1 grid, 2 window, 3 gradient), thin film on the glass in nm (0 none), how mirrored the panes are, lists by screen tile for the full size first look
  lens: vec4f,    // lens radius (0 is a pinhole), distance in focus, take the traced image as it is (no surface matching), -
  glow: vec4f,    // light the second finish's beams give off; upscale beams from traced pixels facing the same way
  extra: vec4f,   // trace the bare sweep in a checkerboard, half of it each image; most images in the glass reflections' history; reflections kept apart
};

struct Light {
  c: vec4f, // centre, cumulative pick probability
  u: vec4f, // half side, area
  v: vec4f, // half side, pick probability
  e: vec4f, // radiance
};

struct Scene {
  verts: array<vec4f, 16>,  // projected corners, beam radius there
  prev: array<vec4f, 16>,   // the same last frame
  edges: array<vec4u, 32>,  // corners, original axis, material
  beams: array<vec4f, 64>,  // each beam's two end spheres
  bounds: array<vec4f, 32>, // a sphere around each beam
  panes: array<vec4f, 120>, // glazed squares, packed: plane (n, d) then four inward edge planes
  lights: array<Light, 8>,
  shown: array<vec4f, 16>,  // the corners when the traced image on show was traced
  prevPlanes: array<vec4f, 24>, // each pane's plane in the traced image before
  paneTint: array<vec4f, 24>,   // each pane's colour, and how dichroic it is (reflecting what it doesn't pass)
};

@group(0) @binding(0) var<uniform> u: U;
const BIG = 1e6;
const PI = 3.14159265;

// The traced grid is not even across the screen: the span the tesseract takes (with some room) gets
// more of the grid's columns and rows than its share, the rest fewer, in three straight pieces each
// way. So the traced pixels are small on the tesseract, where reflections are fine detail, and big on
// the sweep, which is smooth. These map a place in the grid (0..1) to the screen (0..1) and back.
fn warp1(g: f32, w: vec4f) -> f32 {
  if (g < w.z) {
    return g * w.x / w.z;
  }
  if (g < w.w) {
    return w.x + (g - w.z) * (w.y - w.x) / (w.w - w.z);
  }
  return w.y + (g - w.w) * (1.0 - w.y) / (1.0 - w.w);
}
fn unwarp1(s: f32, w: vec4f) -> f32 {
  if (s < w.x) {
    return s * w.z / w.x;
  }
  if (s < w.y) {
    return w.z + (s - w.x) * (w.w - w.z) / (w.y - w.x);
  }
  return w.w + (s - w.y) * (1.0 - w.w) / (1.0 - w.y);
}
// screen per grid, the size of a traced pixel there against an even grid's
fn stretch1(g: f32, w: vec4f) -> f32 {
  if (g < w.z) {
    return w.x / w.z;
  }
  if (g < w.w) {
    return (w.y - w.x) / (w.w - w.z);
  }
  return (1.0 - w.y) / (1.0 - w.w);
}
fn screenOf(g: vec2f) -> vec2f {
  return vec2f(warp1(g.x, u.warpX), warp1(g.y, u.warpY));
}
fn gridOf(s: vec2f) -> vec2f {
  return vec2f(unwarp1(s.x, u.warpX), unwarp1(s.y, u.warpY));
}
fn prevGridOf(s: vec2f) -> vec2f {
  return vec2f(unwarp1(s.x, u.prevWarpX), unwarp1(s.y, u.prevWarpY));
}
fn stretchAt(g: vec2f) -> f32 {
  return max(stretch1(g.x, u.warpX), stretch1(g.y, u.warpY));
}

// the same for the traced image on show
fn tScreenOf(g: vec2f) -> vec2f {
  return vec2f(warp1(g.x, u.tWarpX), warp1(g.y, u.tWarpY));
}
fn tGridOf(s: vec2f) -> vec2f {
  return vec2f(unwarp1(s.x, u.tWarpX), unwarp1(s.y, u.tWarpY));
}
fn tStretchAt(g: vec2f) -> f32 {
  return max(stretch1(g.x, u.tWarpX), stretch1(g.y, u.tWarpY));
}
fn tRayAt(uv: vec2f) -> vec3f {
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  return normalize(u.tFwd.xyz + u.tRight.xyz * ndc.x * u.tRight.w + u.tUp.xyz * ndc.y * u.tUp.w);
}

// the camera ray through a point of the screen, in 0..1 from the top left
fn rayAt(uv: vec2f) -> vec3f {
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  return normalize(u.fwd.xyz + u.right.xyz * ndc.x * u.right.w + u.up.xyz * ndc.y * u.up.w);
}
