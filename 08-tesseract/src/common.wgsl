struct U {
  prevViewProj: mat4x4f, // last frame's camera, in this frame's coordinates
  eye: vec4f, // xyz, frame number
  right: vec4f, // xyz, tan of half the horizontal fov
  up: vec4f, // xyz, tan of half the vertical fov
  fwd: vec4f, // xyz, radians per traced pixel
  shape: vec4f, // inner cube half size s, beam radius, diagonal radius ratio, scale into the root cube
  shape2: vec4f, // A, B of the frustum map, fade of the outermost level, level of detail bias
  sun: vec4f, // direction to the sun, power
  look: vec4f, // exposure, glow, bounces, glow on (0 cubes, 1 w edges, 2 both)
  march: vec4f, // deepest level, step factor, cell margin in pixels, respect cell walls
  res: vec4f, // traced width, height, 1/width, 1/height
  prev: vec4f, // last frame's eye, scale from last frame's distances to this frame's
  accum: vec4f, // most frames to average, cosine of the sun's radius, sky, view (render, levels, cost)
  extra: vec4f, // cone of bounce and shadow rays in radians, camera still
};

@group(0) @binding(0) var<uniform> u: U;

const BIG = 1e6;
