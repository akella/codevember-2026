// The moss ball: long strands with nothing to remember. Each frame they are worked out whole, from
// where the ball is and how far behind it their tips have been left: see `strands` in index.ts.

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read_write> draws: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> list: array<u32>;
@group(0) @binding(3) var<storage, read_write> live: array<Shoot>;
@group(0) @binding(4) var<storage, read_write> grown: array<vec2f>;
@group(0) @binding(5) var<uniform> scene: Scene;

/** somewhere along the path that is always near the ball, for finding stones on the right lap */
const NEAR_BALL = 1.25;

/** a strand goes round a stone, not through it */
fn clearOf(p: vec3f) -> vec3f {
  var q = p;
  for (var j = 0u; j < 9u; j++) {
    let c = stoneNear(j, NEAR_BALL);
    let d = boxDistance(q - c, vec3f(STONE), 0.14);
    if (d < 0.05) {
      let a = abs(q - c);
      let s = sign(q - c);
      let out = select(select(vec3f(0.0, 0.0, s.z), vec3f(0.0, s.y, 0.0), a.y >= a.z), vec3f(s.x, 0.0, 0.0), a.x >= a.y && a.x >= a.z);
      q += out * (0.05 - d);
    }
  }
  return q;
}

/** a strand can lie flat against the ball, but not go into it */
fn offBall(dir: vec3f, n: vec3f, least: f32) -> vec3f {
  return normalize(dir + n * max(least - dot(dir, n), 0.0));
}

@compute @workgroup_size(64)
fn ball(@builtin(global_invocation_id) gid: vec3u) {
  let count = arrayLength(&list) / 2u;
  let i = gid.x;
  if (i >= count) { return; }
  let hair = scene.hair[3]; // length, core, share of strands that grow
  if (hash1(i + 911u) > hair.z) { return; }

  // evenly over a sphere, and only the side that shows, with a little over for what sticks out round it
  let y = 1.0 - 2.0 * (f32(i) + 0.5) / f32(count);
  let ring = sqrt(max(1.0 - y * y, 0.0));
  let around = f32(i) * 2.399963;
  let n = vec3f(cos(around) * ring, y, sin(around) * ring);
  if (dot(n, normalize(frame.eye.xyz - scene.ball.xyz)) < -0.3) { return; }

  let seed = hash1(i);
  let seed2 = hash1(i + 7919u);
  let rank = hash1(i + 104729u);

  // the strands of a clump lean in together, into locks, and it is the locks that show as it moves
  let c = worley(n * 2.3 + 4.0);
  let dome = 1.0 - smoothstep(0.15, 0.95, c.d);
  let height = hair.x * (0.55 + 0.45 * dome) * (0.8 + 0.4 * rank);
  // gold on a ball is a stripe, so it keeps to the odd strand rather than a whole clump
  let pick = fract(c.id * 5.7);
  let kind = select(select(0.0, 1.0, pick < scene.moss[3].y), 2.0, rank > 1.0 - scene.moss[3].x * 0.4);

  // long strands are slow ones, and which of the three a strand follows varies a little anyway
  let slow = clamp(1.0 - height / hair.x + (seed2 - 0.5) * 0.7, 0.0, 1.0) * 2.0;
  let q = select(mix(scene.hair[1].xyz, scene.hair[2].xyz, slow - 1.0), mix(scene.hair[0].xyz, scene.hair[1].xyz, slow), slow < 1.0);
  let bend = q / hair.x;

  var inward = c.to - n * dot(c.to, n);
  inward = inward * 0.55 + (hash33(vec3f(f32(i), 5.0, 2.0)) - 0.5) * 0.5;
  let squash = vec3f(scene.shape.y, scene.shape.x, scene.shape.y);

  // near the root it hardly bends: the tip does nearly all the trailing
  let start = scene.ball.xyz + n * hair.y * squash;
  let knee = clearOf(start + offBall(n + bend * 0.3, n, 0.3) * height * 0.55);
  let tip = clearOf(knee + offBall(n + inward + bend * (0.7 + 0.5 * height / hair.x), n, 0.08) * height * 0.6);
  let up = normalize(knee - start);
  let lean = normalize(tip - knee);

  let sun = frame.sun.xyz;
  let facing = smoothstep(-0.45, 0.5, dot(n, sun));
  let reach = facing * sunOn(start + n * height * 0.6, NEAR_BALL, sun, vec4f(scene.ball.xyz, -99.0));
  let open = (0.4 + 0.6 * pow(dome, 0.5)) * (0.5 + 0.5 * rank);

  for (var side = 0u; side < 2u; side++) {
    let middle = scene.balls[side];
    let at = middle.xyz + n * hair.y * squash;
    let x = ((frame.viewProj * vec4f(at, 1.0)).x * 0.5 + 0.5) * frame.size.x;
    let past = (x - scene.line.x) * select(1.0, -1.0, side == 1u);
    if (past > (height * 1.3 + 0.12 * frame.leaf.x) * frame.sun.w / frame.skyTop.w + scene.line.y) { continue; }

    let id = i + side * count;
    live[id] = Shoot(vec4f(at, height), vec4f(up, middle.w), vec4f(lean, reach), vec4f(seed, kind + seed2 * 0.999, open, BALL_LAYER));
    grown[id] = vec2f(1.0, 0.0);
    let slot = atomicAdd(&draws[side * 5u + 1u], 1u);
    list[side * count + slot] = id;
  }
}
