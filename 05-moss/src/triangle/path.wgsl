// Reutersvärd's triangle, as a helix. Three runs along x, z and y add up to a move straight at the
// viewer, so seen along that line the path closes on itself while really climbing for ever.

const STEP = 3.2;
const TURN = 9.0;
/** half a stone's side */
const STONE = 0.94;

fn onPath(u: f32) -> vec3f {
  let wind = floor(u / TURN);
  let v = u - wind * TURN;
  let run = vec3f(min(v, 3.0), clamp(v - 6.0, 0.0, 3.0), clamp(v - 3.0, 0.0, 3.0));
  return (run + wind * 3.0) * STEP;
}

fn boxDistance(p: vec3f, b: vec3f, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

/** how a place on a stone is doing, `phi` hops after the ball landed: it comes at `first` over `rise`, gone by `last` */
fn alive(phi: f32, first: f32, last: f32, rise: f32) -> f32 {
  return smoothstep(first, first + rise, phi) * (1.0 - smoothstep(last - 1.8, last, phi));
}
