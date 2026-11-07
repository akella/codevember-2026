// The stone objects, as signed distances. The mesh, the shadows and the moss's sense of where the
// damp collects all come from these, so a new form only has to be written here.

fn sdBox(p: vec3f, b: vec3f, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

fn smax(a: f32, b: f32, k: f32) -> f32 {
  return -smin(-a, -b, k);
}

/** a sphere cut along three great circles: the cuts are where water, and so moss, settles first */
fn orb(p: vec3f) -> f32 {
  let c = p - vec3f(0.0, -0.02, 0.0);
  let ball = length(c) - 0.97;
  let t = 0.55;
  let r = vec3f(c.x * cos(t) + c.z * sin(t), c.y, -c.x * sin(t) + c.z * cos(t));
  // cuts only go so deep: past that they would be walls nobody sees, with shoots on them
  let cut = max(min(min(abs(r.x), abs(r.y - 0.18)), abs(r.z)) - 0.026, 0.86 - length(c));
  return smax(ball, -cut, 0.03);
}

/** a stepped pyramid: each ledge is somewhere for moss to sit */
fn steps(p: vec3f) -> f32 {
  var d = 1e3;
  let c = 0.7071;
  let q = vec3f(p.x * c + p.z * c, p.y, -p.x * c + p.z * c);
  for (var i = 0; i < 5; i++) {
    let f = f32(i);
    let half = 0.95 - f * 0.185;
    let y = -0.83 + f * 0.36;
    d = min(d, sdBox(q - vec3f(0.0, y, 0.0), vec3f(half, 0.175, half), 0.02));
  }
  return d;
}

fn ring(p: vec3f) -> f32 {
  let c = p;
  let q = vec2f(length(c.xy) - 0.7, c.z);
  return length(q) - 0.29;
}

/** a cube on its corner with a bowl taken out of the top */
fn cube(p: vec3f) -> f32 {
  // tilt, then turn: that order is what stands a cube's long diagonal straight up
  let a = 0.9553166;
  let s = 0.7071;
  let q0 = vec3f(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a), p.z);
  let q = vec3f(q0.x * s + q0.z * s, q0.y, -q0.x * s + q0.z * s);
  let box = sdBox(q, vec3f(0.585), 0.02);
  let bowl = length(p - vec3f(0.0, 1.05, 0.0)) - 0.6;
  return smax(box, -bowl, 0.04);
}

fn shape(p: vec3f, id: u32) -> f32 {
  switch id {
    case 1u: { return steps(p); }
    case 2u: { return ring(p); }
    case 3u: { return cube(p); }
    default: { return orb(p); }
  }
}

/** the shape, worn: broad weathering and small pits, as much as the mesh can hold */
fn form(p: vec3f, id: u32) -> f32 {
  let wear = fbm(p * 3.1, 3) - 0.5;
  let pits = fbm(p * 13.0 + 4.0, 3) - 0.5;
  return shape(p, id) - wear * 0.03 - pits * 0.007;
}
