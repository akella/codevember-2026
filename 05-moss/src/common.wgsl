// Shared by every shader: the frame's uniforms, noise, and the box the form lives in.

const PI = 3.14159265359;
/** half the side of the cube that holds the form */
const DOM = 1.45;
const GROUND = -1.0;

struct Frame {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  eye: vec4f,      // xyz, w seconds
  sun: vec4f,      // xyz towards the sun, w pixels per unit at distance 1
  sunColor: vec4f, // rgb, w shoots in use
  skyTop: vec4f,   // rgb, w focus distance
  skyLow: vec4f,   // rgb, w aperture
  size: vec4f,     // w, h, 1/w, 1/h
  light: vec4f,    // the sun in screen terms: x right, y down, z away from the camera. w how big the dew is
  leaf: vec4f,     // on top of each kind's own: x size, y width, z how open, w added curl
  tint: vec4f,     // x warmth, y saturation, z brightness, w how much sun comes through a leaf
};

fn toVolume(p: vec3f) -> vec3f {
  return p / (2.0 * DOM) + 0.5;
}

fn pcg3(v0: vec3u) -> vec3u {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> vec3u(16u);
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return v;
}

fn hash33(p: vec3f) -> vec3f {
  let q = pcg3(bitcast<vec3u>(vec3i(floor(p))));
  return vec3f(q) * (1.0 / 4294967295.0);
}

fn hash1(n: u32) -> f32 {
  return f32(pcg3(vec3u(n, 7u, 13u)).x) * (1.0 / 4294967295.0);
}

/** value noise, 0 to 1 */
fn noise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = mix(mix(mix(hash33(i).x, hash33(i + vec3f(1, 0, 0)).x, u.x),
                  mix(hash33(i + vec3f(0, 1, 0)).x, hash33(i + vec3f(1, 1, 0)).x, u.x), u.y),
              mix(mix(hash33(i + vec3f(0, 0, 1)).x, hash33(i + vec3f(1, 0, 1)).x, u.x),
                  mix(hash33(i + vec3f(0, 1, 1)).x, hash33(i + vec3f(1, 1, 1)).x, u.x), u.y), u.z);
  return a;
}

fn fbm(p0: vec3f, octaves: i32) -> f32 {
  var p = p0;
  var sum = 0.0;
  var amp = 0.5;
  var norm = 0.0;
  for (var i = 0; i < octaves; i++) {
    sum += amp * noise(p);
    norm += amp;
    amp *= 0.5;
    p = p * 2.03 + vec3f(17.1, 3.7, 9.2);
  }
  return sum / norm;
}

struct Cell {
  /** distance to the nearest point, in cells */
  d: f32,
  /** distance to the second nearest */
  d2: f32,
  /** from here to the nearest point */
  to: vec3f,
  /** a number that belongs to the nearest cell */
  id: f32,
};

fn worley(p: vec3f) -> Cell {
  let base = floor(p);
  var c = Cell(9.0, 9.0, vec3f(0.0), 0.0);
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let cell = base + vec3f(f32(x), f32(y), f32(z));
        let h = hash33(cell);
        let to = cell + h - p;
        let d = length(to);
        if (d < c.d) {
          c.d2 = c.d;
          c.d = d;
          c.to = to;
          c.id = hash33(cell + 31.0).y;
        } else if (d < c.d2) {
          c.d2 = d;
        }
      }
    }
  }
  return c;
}

/** where a ray enters the box that holds the form */
fn enterBox(p: vec3f, d: vec3f) -> f32 {
  let inv = 1.0 / d;
  let a = (vec3f(-DOM) - p) * inv;
  let b = (vec3f(DOM) - p) * inv;
  let near = min(a, b);
  return max(max(near.x, near.y), near.z);
}

/** what the air looks like in a direction: a dark wood with light caught high in the canopy */
fn sky(dir: vec3f, frame: Frame) -> vec3f {
  let up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  return mix(frame.skyLow.rgb, frame.skyTop.rgb, up * up);
}

/**
 * A fragment's two outputs. A scene of separate things measures depth from each thing's own middle,
 * so depths can only be compared within one thing, and `layer` says which one this is: 1 and up, and
 * 0 for nothing at all. A number and not a distance, as a stone can be drawn at two distances at once.
 */
struct Picture {
  @location(0) color: vec4f,
  @location(1) layer: f32,
};
