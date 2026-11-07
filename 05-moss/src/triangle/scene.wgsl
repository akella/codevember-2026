// What moves, worked out on the CPU each frame. There are two of everything drawn, one for each side
// of the line down the screen: see `sides` in index.ts.

struct Scene {
  stones: array<vec4f, 18>, // [side * 9 + stone] where it is drawn, w distance from the eye
  lives: array<vec4f, 9>,   // x along the path, y hops since the ball landed, z its seed
  balls: array<vec4f, 2>,   // [side] where it is drawn, w distance from the eye
  ball: vec4f,              // where it really is, w radius
  shape: vec4f,             // x height, y width of the squashed ball, z 1 if it is moss, w radius of what is solid
  line: vec4f,              // x the pixel column between the sides, y pixels of margin
  sways: array<vec4f, 9>,   // how far behind its stone a shoot's tip is being left
  moss: array<vec4f, 4>,    // the panel: see `mossData` in index.ts
  hair: array<vec4f, 4>,    // how far a strand's tip is left behind, fast to slow, then x length, y core, z share
};

/** stones are layers 1 to 9: see Picture in common.wgsl */
const BALL_LAYER = 10.0;

/** where another stone really is, on the lap nearest the stone at u */
fn stoneNear(j: u32, u: f32) -> vec3f {
  let other = scene.lives[j].x;
  return onPath(other + round((u - other) / TURN) * TURN);
}

/**
 * Sun on a point of the stone at u: the other stones, and the ball. Stones are taken from where they
 * really are, because their moves are staggered. Each is tried at three places along the ray, which
 * are held at the point itself rather than dropped once they fall behind it: dropping a caster is a
 * hard edge, and it sweeps across a stone whenever another goes by close.
 */
fn sunOn(p: vec3f, u: f32, sun: vec3f, ball: vec4f) -> f32 {
  var lit = 1.0;
  for (var j = 0u; j < 9u; j++) {
    if (scene.lives[j].x == u) { continue; }
    let c = stoneNear(j, u);
    let along = dot(c - p, sun);
    for (var k = -1; k <= 1; k++) {
      let t = max(along + f32(k), 0.0);
      let d = boxDistance(p + sun * t - c, vec3f(STONE), 0.14);
      lit = min(lit, smoothstep(-0.12, 0.1 + 0.075 * t, d));
    }
  }
  let t = max(dot(ball.xyz - p, sun), 0.0);
  lit = min(lit, smoothstep(-0.1, 0.05 + 0.09 * t, length(p + sun * t - ball.xyz) - ball.w));
  return lit;
}

/** how much room a shoot's tip has before it meets another stone */
fn roomAt(p: vec3f, u: f32) -> f32 {
  var room = 9.0;
  for (var j = 0u; j < 9u; j++) {
    if (scene.lives[j].x == u) { continue; }
    room = min(room, boxDistance(p - stoneNear(j, u), vec3f(STONE), 0.14));
  }
  return room;
}

struct Patch {
  /** 1 in the middle of a clump, 0 at its rim and on the bare stone between clumps */
  dome: f32,
  /** hops after the landing that it arrives, and that it has gone */
  first: f32,
  last: f32,
  /** away from the clump's middle, and a number that belongs to the clump */
  out: vec3f,
  id: f32,
};

/**
 * Moss on a stone this small is a few separate tufts, not a coat. Everything about a place follows
 * from the tuft it is in: they rise one at a time outward from the landing, and each dies back from
 * its rim to its middle. The stone's own colour reads this too, so the stains sit under the tufts.
 */
fn patchAt(p: vec3f, seed: f32) -> Patch {
  let q = p + seed;
  let wob = (vec3f(fbm(q * 0.9, 2), fbm(q * 0.9 + 9.0, 2), fbm(q * 0.9 + 19.0, 2)) - 0.5) * 0.9;
  let many = 1.45 * scene.moss[0].y;
  let c = worley(q * many + wob);
  let middle = p + c.to / many;

  // tops are nearly covered, and the sides have gaps that let the stone show
  let cover = select(scene.moss[0].w, scene.moss[0].z, p.y > 0.7);
  let there = step(1.0 - cover, fract(c.id * 3.7));
  let dome = (1.0 - smoothstep(0.2, 0.92, c.d)) * there;

  let away = length(middle - vec3f(0.0, 1.0, 0.0));
  // nothing comes up under the ball while it is still there
  let first = select(99.0, 0.16 + (away * 0.34 + c.id * 0.16 + (1.0 - dome) * 0.3) / scene.moss[2].x, there > 0.5);
  let life = scene.moss[2].y;
  let last = mix(life * 0.58, life, fract(c.id * 11.3)) - (1.0 - dome) * scene.moss[2].z;
  return Patch(dome, first, last, -c.to / max(length(c.to), 1e-4), c.id);
}
