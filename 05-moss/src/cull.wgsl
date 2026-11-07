// Every frame: which shoots have sprouted, how far along they are, and how much detail each is
// worth. Shoots are appended to one list per level of detail, and the draws read those counts.

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> shoots: array<Shoot>;
@group(0) @binding(2) var<storage, read_write> draws: array<atomic<u32>>; // 5 words per level
@group(0) @binding(3) var<storage, read_write> list: array<u32>;
@group(0) @binding(4) var<storage, read_write> grown: array<vec2f>; // the shoot, its fruit
@group(0) @binding(5) var field: texture_3d<f32>;
@group(0) @binding(6) var smooth3: sampler;

const LEVELS = 3u;
const FRUIT = 3u;
const DEW = 4u;

@compute @workgroup_size(128)
fn cull(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let used = u32(frame.sunColor.w);
  if (i >= used) { return; }
  let s = shoots[i];

  let f = textureSampleLevel(field, smooth3, toVolume(s.root.xyz + s.up.xyz * 0.015), 0.0);
  let g = smoothstep(s.look.w, s.look.w + 0.3, f.g);
  grown[i] = vec2f(g, 0.0);
  if (g < 0.02) { return; }

  let tip = s.root.xyz + s.up.xyz * s.root.w;
  let toEye = frame.eye.xyz - tip;
  let dist = length(toEye);
  // past the horizon of the stone nothing shows but the tips, and those only just
  if (dot(s.up.xyz, toEye / dist) < -0.2) { return; }
  let c = frame.viewProj * vec4f(tip, 1.0);
  let edge = c.w * 1.06 + 0.1;
  if (c.w < 0.0 || abs(c.x) > edge || abs(c.y) > edge) { return; }

  // how many pixels a leaf spans, which is what detail buys
  let px = 0.017 * frame.sun.w / dist;
  var level = 2u;
  if (px > 11.0) { level = 0u; } else if (px > 4.5) { level = 1u; }

  // sporophytes rise out of old moss, long after the shoot beneath them
  if (s.look.y >= 4.0) {
    let rise = smoothstep(0.7, 2.2, f.b);
    if (rise > 0.01) {
      grown[i] = vec2f(g, rise);
      let fruit = atomicAdd(&draws[FRUIT * 5u + 1u], 1u);
      list[FRUIT * arrayLength(&shoots) + fruit] = i;
    }
  }

  // dew sits on the tips of tall shoots in grown moss
  if (frame.light.w > 0.0 && g > 0.85 && s.up.w > 0.5 && fract(s.look.x * 57.3) < 0.05) {
    let drop = atomicAdd(&draws[DEW * 5u + 1u], 1u);
    list[DEW * arrayLength(&shoots) + drop] = i;
  }

  // from afar the short shoots down between the tall ones can't be seen, so they don't get drawn
  if (s.up.w < clamp((7.5 - px) / 5.0, 0.0, 1.0) * 0.4) { return; }

  let slot = atomicAdd(&draws[level * 5u + 1u], 1u);
  list[level * arrayLength(&shoots) + slot] = i;
}
