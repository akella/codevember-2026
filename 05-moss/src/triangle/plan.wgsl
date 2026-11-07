// What each shoot will be. As in ../plan.wgsl it belongs to a cushion and a tuft, but it also has a
// fate here: when the moss reaches it after a landing, and when it gives out again.

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> roots: array<vec4f>; // position and stone, then normal
@group(0) @binding(2) var<storage, read_write> shoots: array<Shoot>;
@group(0) @binding(3) var<storage, read_write> fates: array<vec4f>; // first, last, stone, rank
@group(0) @binding(4) var<uniform> scene: Scene;

@compute @workgroup_size(128)
fn plan(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&shoots)) { return; }
  let p = roots[i * 2u].xyz;
  let stone = roots[i * 2u].w;
  let n = roots[i * 2u + 1u].xyz;
  let stoneSeed = scene.lives[u32(stone)].z;
  let seed = hash1(i);
  let seed2 = hash1(i + 7919u);
  let rank = hash1(i + 104729u);

  let here = patchAt(p, stoneSeed);
  let dome = here.dome;
  let moss = scene.moss;

  // each tuft is one kind
  let pick = fract(here.id * 5.7);
  let kind = select(select(0.0, 1.0, pick < moss[3].x + moss[3].y), 2.0, pick < moss[3].x);

  // shoots stand tallest in the middle of a tuft, which is the whole of its shape
  var height = (0.13 + pow(dome, 0.8) * 0.3) * moss[0].x;
  // the stones have to stay cubes, or there is no triangle: moss piles up on the tops, and on the
  // sides and over the edges it stays low and hugs the stone
  let side = 1.0 - smoothstep(0.35, 0.8, n.y);
  let a = abs(p);
  let edge = smoothstep(0.62, 0.9, max(min(a.x, a.y), min(max(a.x, a.y), a.z)));
  height *= mix(1.0, moss[1].x, side) * (1.0 - 0.45 * edge);
  height *= select(select(1.0, 1.25, kind > 0.5), 0.62, kind > 1.5);
  height *= 0.84 + 0.3 * rank;

  var out = here.out * (0.12 + 0.8 * (1.0 - dome)) * moss[1].y;
  out -= n * dot(out, n);
  let wander = (hash33(vec3f(f32(i), 3.0, 1.0)) - 0.5) * 0.28 * moss[1].z;
  let bend = select(1.0, 1.9, kind > 1.5);
  let lean = normalize(n + (out + wander) * bend + vec3f(0.0, 0.3 + 0.7 * side, 0.0));

  // deep in a tuft is dark, and a shoot among taller ones is darker
  let open = (0.42 + 0.58 * pow(dome, 0.5)) * (0.5 + 0.5 * rank);

  shoots[i].root = vec4f(p, height);
  shoots[i].up = vec4f(n, rank);
  shoots[i].lean = vec4f(lean, 1.0);

  // fruit comes from the tallest shoots of the upright kinds
  let fruits = dome > 0.35 && kind < 1.5 && rank > 0.55 && hash1(i + 31337u) < 0.008 * moss[2].w && here.id > 0.35;
  shoots[i].look = vec4f(seed, kind + seed2 * 0.999 + select(0.0, 4.0, fruits), open, 0.0);

  fates[i] = vec4f(here.first + seed2 * 0.1, min(here.last + (rank - 0.5) * 0.5, 8.6), stone, select(0.0, 1.0, fruits));
}
