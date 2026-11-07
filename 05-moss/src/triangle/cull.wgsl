// Every frame: which shoots are alive, and where. ../moss.wgsl draws from world space, so each live
// shoot is written out where it stands right now, once for each side of the line that it falls on.

const SIDES = 2u;
const DEW = 2u;
const FRUIT = 4u;

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> shoots: array<Shoot>;
@group(0) @binding(2) var<storage, read> fates: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> draws: array<atomic<u32>>; // moss by side, then dew by side
@group(0) @binding(4) var<storage, read_write> list: array<u32>;
@group(0) @binding(5) var<storage, read_write> live: array<Shoot>;
@group(0) @binding(6) var<storage, read_write> grown: array<vec2f>;
@group(0) @binding(7) var<uniform> scene: Scene;

@compute @workgroup_size(128)
fn cull(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let count = arrayLength(&shoots);
  if (i >= count) { return; }
  let fate = fates[i];
  let stone = u32(fate.z);
  let life = scene.lives[stone];
  // the page plants more shoots than it uses, and the panel says how many of them come up
  if (hash1(i + 555u) > scene.moss[1].w) { return; }
  let g = alive(life.y, fate.x, fate.y);
  if (g < 0.02) { return; }

  let s = shoots[i];
  let real = onPath(life.x) + s.root.xyz + s.up.xyz * s.root.w;
  let reach = sunOn(real, life.x, frame.sun.xyz, scene.ball);
  // a stone going by close presses the moss flat, instead of the moss passing through it
  let pressed = mix(0.3, 1.0, smoothstep(0.0, 0.34, roomAt(real, life.x)));

  // as far as any part of it gets from its root, in pixels. A shoot is drawn on both sides of the line
  // if it could cross it, or the line would cut it off: a leaf past its tip, or a spore stalk further
  let beyond = 0.12 * frame.leaf.x + select(0.0, 0.42, fate.w > 0.5);
  let spread = (s.root.w * pressed * 1.2 + beyond) * frame.sun.w / frame.skyTop.w + scene.line.y;

  for (var side = 0u; side < SIDES; side++) {
    let middle = scene.stones[side * 9u + stone];
    let at = middle.xyz + s.root.xyz;
    let x = ((frame.viewProj * vec4f(at, 1.0)).x * 0.5 + 0.5) * frame.size.x;
    let past = (x - scene.line.x) * select(1.0, -1.0, side == 1u);
    if (past > spread) { continue; }

    let id = i + side * count;
    // tips are left behind when a stone sets off, and swing past it when it stops
    let lean = normalize(s.lean.xyz + scene.sways[stone].xyz * scene.moss[3].z);
    live[id] = Shoot(vec4f(at, s.root.w * pressed), vec4f(s.up.xyz, middle.w), vec4f(lean, reach), vec4f(s.look.xyz, f32(stone + 1u)));
    // sporophytes rise from moss that has settled, and go with it
    let rise = smoothstep(0.9, 2.4, life.y) * smoothstep(0.1, 0.6, g);
    grown[id] = vec2f(g, rise);
    let slot = atomicAdd(&draws[side * 5u + 1u], 1u);
    list[side * count + slot] = id;

    if (g > 0.8 && fract(s.look.x * 57.3) < 0.03) {
      let drop = atomicAdd(&draws[(DEW + side) * 5u + 1u], 1u);
      list[(DEW + side) * count + drop] = id;
    }
    if (fate.w > 0.5 && rise > 0.01) {
      let fruit = atomicAdd(&draws[(FRUIT + side) * 5u + 1u], 1u);
      list[(FRUIT + side) * count + fruit] = id;
    }
  }
}
