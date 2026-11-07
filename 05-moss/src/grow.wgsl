// The living part: a field that spreads over the skin of the stone.
// r protonema, the green film that goes first. g moss. b age of the moss. a how settled the film is,
// a slow blur of r: moss only rises as far as this lets it, so a stalled edge stays young and thin.

const STEP_SEEDS = 8u;

struct Grow {
  seeds: array<vec4f, 8>, // xyz, w radius (0 for none)
  n: u32,
  tick: u32,
  sporeChance: f32,
  pace: f32,
};

@group(0) @binding(0) var<uniform> grow: Grow;
@group(0) @binding(1) var was: texture_3d<f32>;
@group(0) @binding(2) var now: texture_storage_3d<rgba16float, write>;
@group(0) @binding(3) var volume: texture_3d<f32>;
@group(0) @binding(4) var smooth3: sampler;

fn stone(p: vec3f) -> vec4f {
  return textureSampleLevel(volume, smooth3, toVolume(p), 0.0);
}

@compute @workgroup_size(4, 4, 4)
fn spread(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(grow.n))) { return; }
  let i = vec3i(id);
  let cell = 2.0 * DOM / f32(grow.n);
  let p = (vec3f(id) + 0.5) * cell - DOM;
  let v = stone(p);
  let band = cell * 2.6;
  if (abs(v.a) > band) {
    textureStore(now, id, vec4f(0.0));
    return;
  }

  let c = textureLoad(was, i, 0);
  // only the band exchanges anything, so the front has to go round the form and can't jump a gap
  var around = vec3f(0.0);
  var count = 0.0;
  let offs = array<vec3i, 6>(vec3i(1, 0, 0), vec3i(-1, 0, 0), vec3i(0, 1, 0), vec3i(0, -1, 0), vec3i(0, 0, 1), vec3i(0, 0, -1));
  for (var k = 0; k < 6; k++) {
    let q = i + offs[k];
    let s = stone((vec3f(q) + 0.5) * cell - DOM);
    if (abs(s.a) <= band) {
      around += textureLoad(was, q, 0).rga;
      count += 1.0;
    }
  }
  let lap = around - c.rga * count;

  let wet = v.b;
  // the front stalls on dry ground: slow noise pins it there and lets it finger round
  let drag = fbm(p * 9.0 + 3.0, 3);
  // past one half a front retreats, and at more than one even a full cell dies: dry stone stays bare
  let moss = c.g;
  let allee = mix(0.05, 1.15, clamp(drag * 1.15 - wet * 1.5 + 0.2, 0.0, 1.0));
  let film = c.r;
  var dFilm = 0.05 * lap.x + (0.12 + 0.22 * wet) * film * (1.04 - film) * (film - allee);
  let settled = c.a;
  let dSettled = 0.14 * lap.z + 0.006 * (film - settled);
  let room = smoothstep(0.4, 0.96, settled) * (0.55 + 0.45 * smoothstep(0.1, 0.5, wet));
  var dMoss = 0.02 * lap.y + (0.006 + 0.012 * wet) * (room - moss);

  var nextFilm = film + dFilm * grow.pace;
  var nextMoss = moss + dMoss * grow.pace;

  // spores drift in and start somewhere new, more readily where it is wet
  let roll = pcg3(vec3u(id.x + grow.tick * 131u, id.y + grow.tick * 7u, id.z));
  let chance = grow.sporeChance * wet * wet;
  if (f32(roll.x) * (1.0 / 4294967295.0) < chance) {
    nextFilm = max(nextFilm, 0.9);
  }

  var plantedSettle = 0.0;
  // a planted spot is a spring: it never dries up, whatever stone it was planted on, though the front
  // it feeds still can't cross stone too dry to hold it
  for (var s = 0u; s < STEP_SEEDS; s++) {
    let seed = grow.seeds[s];
    if (seed.w > 0.0) {
      let d = length(p - seed.xyz) / seed.w;
      let touch = exp(-d * d * 2.0);
      nextFilm = max(nextFilm, touch * 1.1);
      nextMoss = min(1.0, nextMoss + touch * 0.02);
      plantedSettle = max(plantedSettle, touch);
    }
  }

  let age = c.b + moss * 0.002 * grow.pace;
  let nextSettled = max(settled + dSettled * grow.pace, plantedSettle);
  textureStore(now, id, vec4f(clamp(nextFilm, 0.0, 1.0), clamp(nextMoss, 0.0, 1.0), min(age, 8.0), clamp(nextSettled, 0.0, 1.0)));
}
